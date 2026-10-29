import { createWriteStream, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { VoiceViLogger } from "../logger.ts";

export const CODESWITCH_MODEL_ID = "nghiasr-vi-en-codeswitch-streaming";

/**
 * Default download source for the custom model (public HuggingFace repo).
 * PASEO_VOICE_VI_MODEL_URL overrides it with another base URL holding the
 * same remote file names (e.g. a mirror or a pinned revision URL).
 */
const DEFAULT_CODESWITCH_MODEL_URL = "https://huggingface.co/NghiMe/NghiASR/resolve/main";

function codeswitchModelBaseUrl(): string | null {
  const fromEnv = process.env.PASEO_VOICE_VI_MODEL_URL?.trim();
  if (fromEnv && fromEnv.length > 0) return fromEnv.replace(/\/+$/, "");
  return DEFAULT_CODESWITCH_MODEL_URL;
}

interface CodeswitchDownloadFile {
  remote: string;
  local: string;
}

const CODESWITCH_MODEL_FILES: CodeswitchDownloadFile[] = [
  { remote: "encoder-epoch-4-avg-4.int8.onnx", local: "encoder.int8.onnx" },
  { remote: "decoder-epoch-4-avg-4.onnx", local: "decoder.onnx" },
  { remote: "joiner-epoch-4-avg-4.int8.onnx", local: "joiner.int8.onnx" },
  { remote: "tokens.txt", local: "tokens.txt" },
];

export interface CodeswitchModelFiles {
  modelDir: string;
  encoderPath: string;
  decoderPath: string;
  joinerPath: string;
  tokensPath: string;
}

const HOME = os.homedir();

/** Known on-disk locations of the custom vi-en codeswitch Zipformer model. */
function candidateCodeswitchDirs(modelsDir?: string | null, extraDirs?: string[]): string[] {
  const candidates = [
    process.env.PASEO_VOICE_VI_CODESWITCH_DIR?.trim(),
    // Model bundled with this plugin (models/<id> next to paseo-plugin.json).
    ...(extraDirs ?? []),
    modelsDir ? path.join(modelsDir, CODESWITCH_MODEL_ID) : undefined,
    path.join(HOME, ".paseo", "models", "local-speech", CODESWITCH_MODEL_ID),
    path.join(HOME, ".voicescribe", "models", CODESWITCH_MODEL_ID),
  ].filter((value): value is string => Boolean(value && value.length > 0));

  const expanded: string[] = [];
  for (const dir of candidates) {
    const resolved = path.resolve(dir);
    // A candidate may be either the model dir itself or a parent holding it.
    expanded.push(resolved);
    if (path.basename(resolved) !== CODESWITCH_MODEL_ID) {
      expanded.push(path.join(resolved, CODESWITCH_MODEL_ID));
    }
  }
  return Array.from(new Set(expanded));
}

function pickExisting(paths: (string | undefined)[]): string | null {
  for (const candidate of paths) {
    if (!candidate) continue;
    try {
      const stat = statSync(candidate);
      if (stat.isFile() && stat.size > 0) return candidate;
    } catch {
      // try next
    }
  }
  return null;
}

function resolveFromDirSync(dir: string): CodeswitchModelFiles | null {
  // The trial model ships symlinks (encoder.onnx -> encoder-epoch-4-avg-4.onnx);
  // accept either the canonical names or the epoch-averaged files.
  const encoderPath = pickExisting([
    path.join(dir, "encoder.int8.onnx"),
    path.join(dir, "encoder.onnx"),
  ]);
  const decoderPath = pickExisting([
    path.join(dir, "decoder.onnx"),
    path.join(dir, "decoder.int8.onnx"),
  ]);
  const joinerPath = pickExisting([
    path.join(dir, "joiner.int8.onnx"),
    path.join(dir, "joiner.onnx"),
  ]);
  const tokensPath = pickExisting([path.join(dir, "tokens.txt")]);
  if (!encoderPath || !decoderPath || !joinerPath || !tokensPath) return null;
  return { modelDir: dir, encoderPath, decoderPath, joinerPath, tokensPath };
}

export function resolveInstalledCodeswitchModelSync(
  modelsDir?: string | null,
  extraDirs?: string[],
): CodeswitchModelFiles | null {
  for (const dir of candidateCodeswitchDirs(modelsDir, extraDirs)) {
    const resolved = resolveFromDirSync(dir);
    if (resolved) return resolved;
  }
  return null;
}

export function isCodeswitchModelInstalledSync(
  modelsDir?: string | null,
  extraDirs?: string[],
): boolean {
  return resolveInstalledCodeswitchModelSync(modelsDir, extraDirs) !== null;
}

export async function isCodeswitchModelInstalled(
  modelsDir: string,
  extraDirs?: string[],
): Promise<boolean> {
  return isCodeswitchModelInstalledSync(modelsDir, extraDirs);
}

export function getCodeswitchModelDirectory(modelsDir: string, extraDirs?: string[]): string {
  const installed = resolveInstalledCodeswitchModelSync(modelsDir, extraDirs);
  if (installed) return installed.modelDir;
  return path.join(modelsDir, CODESWITCH_MODEL_ID);
}

async function downloadFileToPath(
  url: string,
  targetPath: string,
  signal?: AbortSignal,
): Promise<void> {
  const tmpPath = `${targetPath}.part-${process.pid}-${Date.now()}`;
  const response = await fetch(url, { redirect: "follow", signal });
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status} ${response.statusText} while downloading ${url}`);
  }
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const nodeStream = Readable.fromWeb(response.body as never);
  try {
    await pipeline(nodeStream, createWriteStream(tmpPath), { signal });
    await fs.rename(tmpPath, targetPath);
  } catch (error) {
    await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

/**
 * Resolve the model from disk, downloading it first when a model URL is
 * configured (PASEO_VOICE_VI_MODEL_URL). Without a URL it only resolves a
 * local copy and tells the user where to put one — short message, details
 * go to the log.
 */
export async function ensureCodeswitchModel(options: {
  modelsDir: string;
  logger: VoiceViLogger;
  extraDirs?: string[];
  signal?: AbortSignal;
}): Promise<string> {
  const resolved = resolveInstalledCodeswitchModelSync(options.modelsDir, options.extraDirs);
  if (resolved) {
    options.logger.info(
      { modelDir: resolved.modelDir },
      "Resolved installed vi-en codeswitch Zipformer model on disk",
    );
    return resolved.modelDir;
  }
  const baseUrl = codeswitchModelBaseUrl();
  const destDir = path.join(path.resolve(options.modelsDir), CODESWITCH_MODEL_ID);
  if (baseUrl) {
    await fs.mkdir(destDir, { recursive: true });
    for (const { remote, local } of CODESWITCH_MODEL_FILES) {
      const destPath = path.join(destDir, local);
      try {
        const stat = await fs.stat(destPath);
        if (stat.isFile() && stat.size > 0) continue;
      } catch {
        // download below
      }
      options.logger.info(
        { remote, baseUrl },
        "Downloading vi-en codeswitch model file",
      );
      await downloadFileToPath(`${baseUrl}/${remote}`, destPath, options.signal);
    }
    const downloaded = resolveFromDirSync(destDir);
    if (!downloaded) {
      throw new Error(
        `Model download completed at ${destDir}, but required files were not found.`,
      );
    }
    options.logger.info(
      { modelDir: downloaded.modelDir },
      "Vi-en codeswitch model ready",
    );
    return downloaded.modelDir;
  }
  const searched = candidateCodeswitchDirs(options.modelsDir, options.extraDirs).join(", ");
  options.logger.info(
    { searched, destDir },
    "Vi-en codeswitch model not found on disk, downloading from HuggingFace",
  );
  throw new Error(
    `Vi-en codeswitch model not found. ` +
      `Copy "${CODESWITCH_MODEL_ID}" to ${destDir}, ` +
      `set PASEO_VOICE_VI_CODESWITCH_DIR to its location, ` +
      `or set PASEO_VOICE_VI_MODEL_URL to a download base URL.`,
  );
}

export function codeswitchModelDownloadHint(_modelsDir: string): string {
  return `The model downloads automatically (~77 MB) from HuggingFace on first use.`;
}
