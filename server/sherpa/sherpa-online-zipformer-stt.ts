import { EventEmitter } from "node:events";
import { randomUUID as uuidv4 } from "node:crypto";
import type { VoiceViLogger } from "../logger.ts";

import {
  parsePcm16MonoWav,
  parsePcmRateFromFormat,
  pcm16lePeakAbs,
  pcm16leToFloat32,
} from "../audio.ts";
import type {
  SpeechToTextProvider,
  StreamingTranscriptionCommittedEvent,
  StreamingTranscriptionEvent,
  StreamingTranscriptionSession,
  TranscriptionResult,
} from "../speech-provider.ts";
import {
  collapseRepeats,
  normalizeCasing,
  normalizeChunkGain,
  resampleLinear,
} from "./streaming-utils.ts";
import { loadSherpaOnnxNode } from "./sherpa-onnx-node-loader.ts";

export interface SherpaOnlineZipformerSttConfig {
  modelDir?: string;
  encoderPath?: string;
  decoderPath?: string;
  joinerPath?: string;
  tokensPath?: string;
  numThreads?: number;
  sampleRate?: number;
  featureDim?: number;
  defaultLanguage?: string;
}

interface SherpaOfflineRecognizerInstance {
  createStream(): unknown;
  decode(stream: unknown): void;
  getResult(stream: unknown): { text?: string } | null | undefined;
  free?(): void;
}

const DEFAULT_SAMPLE_RATE = 16000;
// Zipformer features are 80-dim log Mel filterbanks.
const DEFAULT_FEATURE_DIM = 80;

export function normalizeCodeswitchLanguage(language?: string | null): string {
  const trimmed = language?.trim().toLowerCase();
  if (!trimmed) {
    return "vi";
  }
  if (trimmed === "auto") {
    return "auto";
  }
  const base = trimmed.split(/[-_]/)[0];
  return base || "vi";
}

/**
 * Offline-backed engine for the vi-en codeswitch Zipformer trial model.
 *
 * The trial package ships an OFFLINE transducer (no streaming encoder
 * graphs), so `OnlineRecognizer` cannot load it. Dictation instead buffers
 * PCM16 per segment and runs one offline pass on `commit()` — the same
 * cadence the daemon drives (append while the mic is open, commit on stop).
 */
export class SherpaOnlineZipformerEngine {
  private readonly logger: VoiceViLogger;
  private readonly config: Required<Omit<SherpaOnlineZipformerSttConfig, "modelDir">> & {
    modelDir?: string;
  };
  private recognizer: SherpaOfflineRecognizerInstance | null = null;

  constructor(config: SherpaOnlineZipformerSttConfig, logger: VoiceViLogger) {
    this.logger = logger.child({ component: "sherpa-offline-zipformer-engine" });
    const baseDir = config.modelDir ?? "";
    this.config = {
      modelDir: config.modelDir,
      encoderPath: config.encoderPath ?? `${baseDir}/encoder.int8.onnx`,
      decoderPath: config.decoderPath ?? `${baseDir}/decoder.onnx`,
      joinerPath: config.joinerPath ?? `${baseDir}/joiner.int8.onnx`,
      tokensPath: config.tokensPath ?? `${baseDir}/tokens.txt`,
      numThreads: config.numThreads ?? 4,
      sampleRate: config.sampleRate ?? DEFAULT_SAMPLE_RATE,
      featureDim: config.featureDim ?? DEFAULT_FEATURE_DIM,
      defaultLanguage: normalizeCodeswitchLanguage(config.defaultLanguage),
    };
  }

  get sampleRate(): number {
    return this.config.sampleRate;
  }

  get defaultLanguage(): string {
    return this.config.defaultLanguage;
  }

  private ensureRecognizer(): SherpaOfflineRecognizerInstance {
    if (this.recognizer) {
      return this.recognizer;
    }

    const sherpa = loadSherpaOnnxNode();
    if (!sherpa.OfflineRecognizer) {
      throw new Error("sherpa-onnx-node does not expose OfflineRecognizer");
    }

    const recognizerConfig = {
      featConfig: {
        sampleRate: this.config.sampleRate,
        featureDim: this.config.featureDim,
      },
      modelConfig: {
        transducer: {
          encoder: this.config.encoderPath,
          decoder: this.config.decoderPath,
          joiner: this.config.joinerPath,
        },
        tokens: this.config.tokensPath,
        numThreads: this.config.numThreads,
        provider: "cpu",
        debug: 0,
      },
      decodingMethod: "greedy_search",
      maxActivePaths: 4,
    };

    this.logger.info(
      {
        encoderPath: this.config.encoderPath,
        numThreads: this.config.numThreads,
        sampleRate: this.config.sampleRate,
        featureDim: this.config.featureDim,
        defaultLanguage: this.config.defaultLanguage,
      },
      "Initializing sherpa-onnx OfflineRecognizer for vi-en codeswitch Zipformer ASR",
    );

    this.recognizer = new sherpa.OfflineRecognizer(
      recognizerConfig,
    ) as SherpaOfflineRecognizerInstance;
    return this.recognizer;
  }

  transcribeFloat32(
    samples: Float32Array,
    sampleRate: number,
    language?: string,
  ): TranscriptionResult {
    const start = Date.now();
    const normalizedRate = this.config.sampleRate;
    const mono16k =
      sampleRate === normalizedRate ? samples : resampleLinear(samples, sampleRate, normalizedRate);
    const gained = normalizeChunkGain(mono16k);

    const recognizer = this.ensureRecognizer();
    const stream = recognizer.createStream() as {
      acceptWaveform: (input: { sampleRate: number; samples: Float32Array }) => void;
    };
    stream.acceptWaveform({ sampleRate: normalizedRate, samples: gained });
    recognizer.decode(stream as unknown);
    const raw = recognizer.getResult(stream as unknown);
    const text = normalizeCasing(collapseRepeats(typeof raw?.text === "string" ? raw.text.trim() : ""));
    return {
      text,
      language: normalizeCodeswitchLanguage(language ?? this.config.defaultLanguage),
      duration: Date.now() - start,
      isLowConfidence: text.length === 0,
    };
  }

  free(): void {
    try {
      this.recognizer?.free?.();
    } catch {
      // ignore
    }
    this.recognizer = null;
  }
}

export class SherpaOnlineZipformerRealtimeSession
  extends EventEmitter
  implements StreamingTranscriptionSession
{
  public readonly requiredSampleRate: number;
  private readonly engine: SherpaOnlineZipformerEngine;
  private readonly language: string;
  private connected = false;
  private currentSegmentId: string | null = null;
  private previousSegmentId: string | null = null;
  private bufferedChunks: Buffer[] = [];
  private bufferedBytes = 0;

  constructor(options: { engine: SherpaOnlineZipformerEngine; language?: string }) {
    super();
    this.engine = options.engine;
    this.requiredSampleRate = this.engine.sampleRate;
    this.language = normalizeCodeswitchLanguage(options.language ?? options.engine.defaultLanguage);
  }

  async connect(): Promise<void> {
    if (this.connected) {
      return;
    }
    this.currentSegmentId = uuidv4();
    this.bufferedChunks = [];
    this.bufferedBytes = 0;
    this.connected = true;
  }

  appendPcm16(pcm16le: Buffer): void {
    if (!this.connected || !this.currentSegmentId) {
      this.emit("error", new Error("Zipformer realtime session not connected"));
      return;
    }
    if (pcm16le.length === 0) {
      return;
    }
    const aligned = pcm16le.length % 2 === 0 ? pcm16le : pcm16le.subarray(0, pcm16le.length - 1);
    if (aligned.length === 0) {
      return;
    }
    this.bufferedChunks.push(Buffer.from(aligned));
    this.bufferedBytes += aligned.length;
  }

  commit(): void {
    if (!this.connected || !this.currentSegmentId) {
      this.emit("error", new Error("Zipformer realtime session not connected"));
      return;
    }

    try {
      const segmentId = this.currentSegmentId;
      const previousSegmentId = this.previousSegmentId;
      const audio =
        this.bufferedChunks.length === 0
          ? Buffer.alloc(0)
          : Buffer.concat(this.bufferedChunks, this.bufferedBytes);

      this.previousSegmentId = segmentId;
      this.currentSegmentId = uuidv4();
      this.bufferedChunks = [];
      this.bufferedBytes = 0;

      // Synchronous decode: the daemon may close the session as soon as it
      // sees our response, so the final must be emitted before commit()
      // returns — never deferred to a later tick.
      let transcript = "";
      if (audio.length > 0) {
        const float32 = pcm16leToFloat32(audio);
        const result = this.engine.transcribeFloat32(float32, this.requiredSampleRate, this.language);
        transcript = result.text;
      }

      const committedPayload: StreamingTranscriptionCommittedEvent = {
        segmentId,
        previousSegmentId,
      };
      const transcriptPayload: StreamingTranscriptionEvent = {
        segmentId,
        transcript,
        isFinal: true,
        language: this.language,
        ...(transcript.length === 0 ? { isLowConfidence: true } : {}),
      };
      this.emit("committed", committedPayload);
      this.emit("transcript", transcriptPayload);
    } catch (err) {
      this.emit("error", err instanceof Error ? err : new Error(String(err)));
    }
  }

  clear(): void {
    if (!this.connected) {
      return;
    }
    this.currentSegmentId = uuidv4();
    this.bufferedChunks = [];
    this.bufferedBytes = 0;
  }

  close(): void {
    this.connected = false;
    this.currentSegmentId = null;
    this.bufferedChunks = [];
    this.bufferedBytes = 0;
  }
}

export class SherpaOnlineZipformerSTT implements SpeechToTextProvider {
  public readonly id = "local" as const;
  private readonly logger: VoiceViLogger;
  private readonly engine: SherpaOnlineZipformerEngine;
  private readonly defaultLanguage: string;
  private readonly silencePeakThreshold: number;

  constructor(
    configOrEngine:
      | SherpaOnlineZipformerSttConfig
      | SherpaOnlineZipformerEngine
      | { engine: SherpaOnlineZipformerEngine; defaultLanguage?: string },
    logger: VoiceViLogger,
    defaultLanguage?: string,
    silencePeakThreshold: number = 200,
  ) {
    this.logger = logger.child({
      module: "speech",
      provider: "local",
      component: "codeswitch-zipformer-stt",
    });
    this.silencePeakThreshold = silencePeakThreshold;
    if (configOrEngine instanceof SherpaOnlineZipformerEngine) {
      this.engine = configOrEngine;
      this.defaultLanguage = normalizeCodeswitchLanguage(
        defaultLanguage ?? configOrEngine.defaultLanguage,
      );
    } else if (
      "engine" in configOrEngine &&
      configOrEngine.engine instanceof SherpaOnlineZipformerEngine
    ) {
      this.engine = configOrEngine.engine;
      this.defaultLanguage = normalizeCodeswitchLanguage(
        defaultLanguage ?? configOrEngine.defaultLanguage ?? configOrEngine.engine.defaultLanguage,
      );
    } else {
      const cfg = configOrEngine as SherpaOnlineZipformerSttConfig;
      this.engine = new SherpaOnlineZipformerEngine(cfg, this.logger);
      this.defaultLanguage = normalizeCodeswitchLanguage(defaultLanguage ?? cfg.defaultLanguage);
    }
  }

  public createSession(params: {
    logger: VoiceViLogger;
    language?: string;
    prompt?: string;
  }): StreamingTranscriptionSession {
    return new SherpaOnlineZipformerRealtimeSession({
      engine: this.engine,
      language: params.language ?? this.defaultLanguage,
    });
  }

  public async transcribeAudio(audioBuffer: Buffer, format: string): Promise<TranscriptionResult> {
    const start = Date.now();
    if (audioBuffer.length === 0) {
      return {
        text: "",
        language: this.defaultLanguage,
        duration: 0,
        isLowConfidence: true,
      };
    }

    const fmt = format.trim().toLowerCase();
    let sampleRate = this.engine.sampleRate;
    let pcm16: Buffer;

    if (fmt.includes("audio/wav") || fmt === "audio/wave") {
      const parsed = parsePcm16MonoWav(audioBuffer);
      sampleRate = parsed.sampleRate;
      pcm16 = parsed.pcm16;
    } else if (fmt.includes("audio/pcm")) {
      sampleRate = parsePcmRateFromFormat(fmt, this.engine.sampleRate) ?? this.engine.sampleRate;
      pcm16 =
        audioBuffer.length % 2 === 0
          ? audioBuffer
          : audioBuffer.subarray(0, audioBuffer.length - 1);
    } else {
      throw new Error(`Unsupported audio format for Zipformer STT: ${format}`);
    }

    const peak = pcm16lePeakAbs(pcm16);
    if (peak < this.silencePeakThreshold) {
      return {
        text: "",
        language: this.defaultLanguage,
        duration: Date.now() - start,
        isLowConfidence: true,
      };
    }

    const float32 = pcm16leToFloat32(pcm16);
    return this.engine.transcribeFloat32(float32, sampleRate, this.defaultLanguage);
  }
}
