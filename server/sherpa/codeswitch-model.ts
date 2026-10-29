import { statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { VoiceViLogger } from "../logger.ts";

export const CODESWITCH_MODEL_ID = "nghiasr-vi-en-codeswitch-streaming";

export interface CodeswitchModelFiles {
  modelDir: string;
  encoderPath: string;
  decoderPath: string;
  joinerPath: string;
  tokensPath: string;
}

const HOME = os.homedir();

/** Known on-disk locations of the custom vi-en codeswitch Zipformer model. */
function candidateCodeswitchDirs(modelsDir?: string | null): string[] {
  const candidates = [
    process.env.PASEO_VOICE_VI_CODESWITCH_DIR?.trim(),
    // meeting-minutes project: dev + bundled + built sidecar copies.
    "/Users/luongcoder/Documents/AI/meeting-minutes/src-python/models/local",
    "/Users/luongcoder/Documents/AI/meeting-minutes/src-tauri/resources/models/local",
    path.join(HOME, "Documents/AI/meeting-minutes/src-python/models/local"),
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
): CodeswitchModelFiles | null {
  for (const dir of candidateCodeswitchDirs(modelsDir)) {
    const resolved = resolveFromDirSync(dir);
    if (resolved) return resolved;
  }
  return null;
}

export function isCodeswitchModelInstalledSync(modelsDir?: string | null): boolean {
  return resolveInstalledCodeswitchModelSync(modelsDir) !== null;
}

export async function isCodeswitchModelInstalled(modelsDir: string): Promise<boolean> {
  return isCodeswitchModelInstalledSync(modelsDir);
}

export function getCodeswitchModelDirectory(modelsDir: string): string {
  const installed = resolveInstalledCodeswitchModelSync(modelsDir);
  if (installed) return installed.modelDir;
  return path.join(modelsDir, CODESWITCH_MODEL_ID);
}

/**
 * The codeswitch model is custom-built (no public download URL), so "ensure"
 * only resolves a local copy and tells the user where to put one.
 */
export async function ensureCodeswitchModel(options: {
  modelsDir: string;
  logger: VoiceViLogger;
}): Promise<string> {
  const resolved = resolveInstalledCodeswitchModelSync(options.modelsDir);
  if (resolved) {
    options.logger.info(
      { modelDir: resolved.modelDir },
      "Resolved installed vi-en codeswitch Zipformer model on disk",
    );
    return resolved.modelDir;
  }
  const searched = candidateCodeswitchDirs(options.modelsDir).join(", ");
  throw new Error(
    `Vi-en codeswitch model "${CODESWITCH_MODEL_ID}" not found. ` +
      `Copy the model directory to ${path.join(options.modelsDir, CODESWITCH_MODEL_ID)} ` +
      `or set PASEO_VOICE_VI_CODESWITCH_DIR to its location. Searched: ${searched}.`,
  );
}

export function codeswitchModelDownloadHint(modelsDir: string): string {
  return (
    `The vi-en codeswitch model is custom-built and has no download URL. ` +
    `Copy "${CODESWITCH_MODEL_ID}" to ${path.join(modelsDir, CODESWITCH_MODEL_ID)} ` +
    `or set PASEO_VOICE_VI_CODESWITCH_DIR.`
  );
}
