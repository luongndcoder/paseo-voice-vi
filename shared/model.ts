/**
 * Model identity helpers shared by the worker, the plugin server and the
 * maintenance scripts. Dependency-free on purpose: the daemon forks
 * bin/worker.mjs straight from the checkout, where only production
 * dependencies exist — this module must never import the plugin SDK or zod.
 */

export type VoiceModelId = "codeswitch" | "nemotron";

export const VOICE_MODEL_ENV = "PASEO_VOICE_VI_MODEL";

export const VOICE_MODELS: { id: VoiceModelId; label: string; modelDir: string }[] = [
  {
    id: "codeswitch",
    label: "NghiMe vi-en codeswitch Zipformer (~75 MB)",
    modelDir: "nghiasr-vi-en-codeswitch-streaming",
  },
  {
    id: "nemotron",
    label: "NVIDIA Nemotron 3.5 streaming (~650 MB)",
    modelDir: "nemotron-3.5-560ms-int8",
  },
];

export function voiceModelLabel(id: string): string {
  return VOICE_MODELS.find((m) => m.id === id)?.label ?? id;
}

/** Which engine the worker (and setup screen) uses. Daemon env wins. */
export function resolveActiveModelId(env?: Record<string, string | undefined>): VoiceModelId {
  const raw = (env ?? process.env)[VOICE_MODEL_ENV]?.trim().toLowerCase();
  if (!raw) return "codeswitch";
  if (raw === "codeswitch" || raw === "nemotron") return raw;
  throw new Error(
    `Invalid ${VOICE_MODEL_ENV}=${JSON.stringify(raw)}. Use "codeswitch" or "nemotron".`,
  );
}

export const SELECTION_FILE_NAME = "paseo-voice-vi.json";

/** Parse the persisted model choice without zod (worker has no zod). */
export function parseModelSelection(value: unknown): VoiceModelId | null {
  if (typeof value !== "object" || value === null) return null;
  const model = (value as { model?: unknown }).model;
  return model === "codeswitch" || model === "nemotron" ? model : null;
}
