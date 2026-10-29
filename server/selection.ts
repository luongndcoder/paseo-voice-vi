import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ModelSelectionSchema,
  SELECTION_FILE_NAME,
  VOICE_MODEL_ENV,
  type VoiceModelId,
} from "../shared/contract.ts";

export function selectionFilePath(paseoHome: string): string {
  return path.join(paseoHome, SELECTION_FILE_NAME);
}

/** Model id saved by the setup screen. Null when never chosen. */
export function readModelSelection(paseoHome: string): VoiceModelId | null {
  try {
    if (!existsSync(selectionFilePath(paseoHome))) return null;
    const parsed: unknown = JSON.parse(readFileSync(selectionFilePath(paseoHome), "utf8"));
    const result = ModelSelectionSchema.safeParse(parsed);
    return result.success ? result.data.model : null;
  } catch {
    return null;
  }
}

export function writeModelSelection(paseoHome: string, model: VoiceModelId): string {
  const target = selectionFilePath(paseoHome);
  writeFileSync(target, `${JSON.stringify({ model }, null, 2)}\n`, "utf8");
  return target;
}

export function resolvePaseoHomeDir(): string {
  const fromEnv = process.env.PASEO_HOME?.trim();
  if (fromEnv && fromEnv.length > 0) return path.resolve(fromEnv);
  return path.join(os.homedir(), ".paseo");
}

export function resolveEffectiveModel(paseoHome = resolvePaseoHomeDir()): {
  id: VoiceModelId;
  source: "env" | "file" | "default";
} {
  const fromEnv = process.env[VOICE_MODEL_ENV]?.trim().toLowerCase();
  if (fromEnv) {
    if (fromEnv !== "codeswitch" && fromEnv !== "nemotron") {
      throw new Error(
        `Invalid ${VOICE_MODEL_ENV}=${JSON.stringify(fromEnv)}. Use "codeswitch" or "nemotron".`,
      );
    }
    return { id: fromEnv, source: "env" };
  }
  const stored = readModelSelection(paseoHome);
  return { id: stored ?? "codeswitch", source: stored ? "file" : "default" };
}
