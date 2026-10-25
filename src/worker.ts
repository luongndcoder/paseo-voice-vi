/**
 * Standalone Vietnamese dictation STT worker speaking the Paseo local-speech worker protocol
 * over Node IPC. The daemon (>= this fork) forks this module when dictation STT is configured
 * as `provider: "external"` with `stt.external.command` pointing at it. Voice-mode STT, TTS
 * and turn detection stay with the daemon's built-in worker; this process only handles
 * `dictationStt` sessions with the Nemotron streaming model.
 *
 * The model downloads on first use into the daemon's models dir (`config.modelsDir`), the
 * same layout the built-in worker uses, so both workers share one on-disk model.
 */
import type { StreamingTranscriptionSession } from "./speech-provider.ts";
import { logger } from "./logger.ts";
import {
  SherpaOnlineNemotronEngine,
  SherpaOnlineNemotronSTT,
} from "./sherpa/sherpa-online-nemotron-stt.ts";
import {
  ensureVietnameseDictationModel,
  getVietnameseDictationModelDirectory,
  resolveInstalledNemotronModelSync,
} from "./sherpa/vietnamese-model.ts";
import { workerBytesToBuffer } from "./worker-bytes.ts";

process.title = "Paseo Voice VI";

export interface VoiceViWorkerConfig {
  modelsDir: string;
  dictationLanguage?: string;
}

export type VoiceViWorkerRequest =
  | { type: "stt.transcribe"; requestId: string; config: VoiceViWorkerConfig; audio: ArrayBuffer; format: string }
  | { type: "session.create"; requestId: string; config: VoiceViWorkerConfig; sessionId: string; kind: string }
  | { type: "session.append"; requestId: string; sessionId: string; audio: ArrayBuffer }
  | { type: "session.commit"; requestId: string; sessionId: string }
  | { type: "session.clear"; requestId: string; sessionId: string }
  | { type: "session.flush"; requestId: string; sessionId: string }
  | { type: "session.reset"; requestId: string; sessionId: string }
  | { type: "session.close"; requestId: string; sessionId: string };

export type VoiceViWorkerToParentMessage =
  | { type: "response"; requestId: string; ok: true; result?: unknown }
  | { type: "response"; requestId: string; ok: false; error: string }
  | { type: "session.transcript"; sessionId: string; payload: unknown }
  | { type: "session.committed"; sessionId: string; payload: unknown }
  | { type: "session.error"; sessionId: string; error: string };

const sttEngines = new Map<string, SherpaOnlineNemotronEngine>();
const sttProviders = new Map<string, SherpaOnlineNemotronSTT>();
const sessions = new Map<string, StreamingTranscriptionSession>();
let ipcClosing = false;

function sendToParent(message: VoiceViWorkerToParentMessage): void {
  if (ipcClosing || !process.connected || !process.send) {
    return;
  }
  try {
    process.send(message, (error) => {
      if (error) {
        ipcClosing = true;
      }
    });
  } catch {
    ipcClosing = true;
  }
}

function sttEngineKey(config: VoiceViWorkerConfig): string {
  return `${config.modelsDir}:nemotron-3.5-560ms-int8`;
}

async function getSttProvider(config: VoiceViWorkerConfig): Promise<SherpaOnlineNemotronSTT> {
  const key = sttEngineKey(config);
  const existing = sttProviders.get(key);
  if (existing) {
    return existing;
  }
  let resolved = resolveInstalledNemotronModelSync(config.modelsDir);
  if (!resolved) {
    logger.info({ modelsDir: config.modelsDir }, "Vietnamese model missing; downloading");
    await ensureVietnameseDictationModel({ modelsDir: config.modelsDir, logger });
    resolved = resolveInstalledNemotronModelSync(config.modelsDir);
  }
  const modelDir = resolved?.modelDir ?? getVietnameseDictationModelDirectory(config.modelsDir);
  const engineKey = sttEngineKey(config);
  let engine = sttEngines.get(engineKey);
  if (!engine) {
    engine = new SherpaOnlineNemotronEngine(
      {
        modelDir,
        encoderPath: resolved?.encoderPath,
        decoderPath: resolved?.decoderPath,
        joinerPath: resolved?.joinerPath,
        tokensPath: resolved?.tokensPath,
        numThreads: 4,
      },
      logger as never,
    );
    sttEngines.set(engineKey, engine);
  }
  const created = new SherpaOnlineNemotronSTT(
    { engine, defaultLanguage: config.dictationLanguage || "vi" },
    logger as never,
  );
  sttProviders.set(key, created);
  return created;
}

function cleanupSession(sessionId: string): void {
  const session = sessions.get(sessionId);
  sessions.delete(sessionId);
  try {
    session?.close();
  } catch {
    // ignore
  }
}

function trackTranscriptionSession(
  sessionId: string,
  session: StreamingTranscriptionSession,
): void {
  session.on("committed", (payload) => {
    sendToParent({ type: "session.committed", sessionId, payload });
  });
  session.on("transcript", (payload) => {
    sendToParent({ type: "session.transcript", sessionId, payload });
  });
  session.on("error", (err) => {
    sendToParent({
      type: "session.error",
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}

async function createSession(
  message: Extract<VoiceViWorkerRequest, { type: "session.create" }>,
): Promise<{ requiredSampleRate: number }> {
  if (message.kind !== "dictationStt") {
    throw new Error(
      `paseo-voice-vi worker only supports dictationStt sessions (got "${message.kind}")`,
    );
  }
  cleanupSession(message.sessionId);
  const provider = await getSttProvider(message.config);
  const session = provider.createSession({
    logger: logger as never,
    language: message.config.dictationLanguage || "vi",
  });
  trackTranscriptionSession(message.sessionId, session);
  await session.connect();
  sessions.set(message.sessionId, session);
  return { requiredSampleRate: session.requiredSampleRate };
}

function sendOk(requestId: string, result?: unknown): void {
  sendToParent({ type: "response", requestId, ok: true, result });
}

type VoiceViSessionRequest = Extract<
  VoiceViWorkerRequest,
  {
    type:
      | "session.append"
      | "session.commit"
      | "session.clear"
      | "session.flush"
      | "session.reset"
      | "session.close";
  }
>;

function handleSessionRequest(message: VoiceViSessionRequest): void {
  if (message.type === "session.close") {
    cleanupSession(message.sessionId);
    sendOk(message.requestId);
    return;
  }
  const session = sessions.get(message.sessionId);
  switch (message.type) {
    case "session.append":
      session?.appendPcm16(workerBytesToBuffer(message.audio));
      break;
    case "session.commit":
      if (session && "commit" in session) {
        session.commit();
      }
      break;
    case "session.clear":
      if (session && "clear" in session) {
        session.clear();
      }
      break;
    case "session.flush":
      if (session && "flush" in session) {
        session.flush();
      }
      break;
    case "session.reset":
      if (session && "reset" in session) {
        session.reset();
      }
      break;
  }
  sendOk(message.requestId);
}

async function handleRequest(message: VoiceViWorkerRequest): Promise<void> {
  if (message.type === "stt.transcribe") {
    const provider = await getSttProvider(message.config);
    const result = await provider.transcribeAudio(
      workerBytesToBuffer(message.audio),
      message.format,
    );
    sendOk(message.requestId, result);
    return;
  }
  if (message.type === "session.create") {
    sendOk(message.requestId, await createSession(message));
    return;
  }
  handleSessionRequest(message);
}

process.on("message", (message: VoiceViWorkerRequest) => {
  void handleRequest(message).catch((error: unknown) => {
    sendToParent({
      type: "response",
      requestId: message.requestId,
      ok: false,
      error: error instanceof Error ? error.message : "paseo-voice-vi worker request failed",
    });
  });
});

process.once("disconnect", () => {
  ipcClosing = true;
  for (const sessionId of Array.from(sessions.keys())) {
    cleanupSession(sessionId);
  }
  for (const engine of sttEngines.values()) {
    try {
      engine.free();
    } catch {
      // ignore
    }
  }
});
