import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const PLUGIN_ID = "paseo-voice-vi";
export const WORKER_FILE_NAME = "worker.mjs";
export const MODEL_ID = "nghiasr-vi-en-codeswitch-streaming";

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

/** Which engine the worker (and setup screen) uses. Daemon env wins. */
export function resolveActiveModelId(env?: Record<string, string | undefined>): VoiceModelId {
  const raw = (env ?? process.env)[VOICE_MODEL_ENV]?.trim().toLowerCase();
  if (!raw) return "codeswitch";
  if (raw === "codeswitch" || raw === "nemotron") return raw;
  throw new Error(
    `Invalid ${VOICE_MODEL_ENV}=${JSON.stringify(raw)}. Use "codeswitch" or "nemotron".`,
  );
}

export function voiceModelLabel(id: string): string {
  return VOICE_MODELS.find((m) => m.id === id)?.label ?? id;
}

export const SELECTION_FILE_NAME = "paseo-voice-vi.json";

export const ModelSelectionSchema = z.object({
  model: z.enum(["codeswitch", "nemotron"]),
});
export type ModelSelection = z.infer<typeof ModelSelectionSchema>;

export const JobSchema = z.object({
  id: z.string(),
  kind: z.enum(["download-model", "self-test"]),
  state: z.enum(["running", "succeeded", "failed"]),
  message: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
});
export type Job = z.infer<typeof JobSchema>;

export const SelectModelInputSchema = z.object({
  id: z.enum(["codeswitch", "nemotron"]),
});

export const selectModelRpc = defineRpc({
  name: "voicevi.model.select",
  input: SelectModelInputSchema,
  output: z.object({ started: z.boolean(), job: JobSchema }),
});

export const ModelStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  installed: z.boolean(),
  directory: z.string(),
});
export type ModelStatus = z.infer<typeof ModelStatusSchema>;

export const StatusSchema = z.object({
  paseoHome: z.string(),
  activeModelId: z.string(),
  selectionSource: z.enum(["env", "file", "default"]),
  models: z.array(ModelStatusSchema),
  configPath: z.string(),
  configReadable: z.boolean(),
  configError: z.string().nullable(),
  pluginDirectory: z.string().nullable(),
  workerPath: z.string().nullable(),
  workerExists: z.boolean(),
  sherpaInstalled: z.boolean(),
  modelsDir: z.string(),
  modelInstalled: z.boolean(),
  modelDirectory: z.string(),
  dictation: z.object({
    enabled: z.boolean(),
    provider: z.string().nullable(),
    language: z.string().nullable(),
    command: z.string().nullable(),
    commandMatchesWorker: z.boolean(),
  }),
  configSnippet: z.string(),
  job: JobSchema.nullable(),
  warnings: z.array(z.string()),
});
export type Status = z.infer<typeof StatusSchema>;

export const ApplyConfigInputSchema = z.object({
  language: z.string().trim().min(2).max(16).default("vi"),
});
export type ApplyConfigInput = z.infer<typeof ApplyConfigInputSchema>;

export const ApplyConfigResultSchema = z.object({
  configPath: z.string(),
  backupPath: z.string(),
  command: z.string(),
  reloadRequired: z.boolean(),
});
export type ApplyConfigResult = z.infer<typeof ApplyConfigResultSchema>;

export const EmptyInputSchema = z.object({});

export const statusRpc = defineRpc({
  name: "voicevi.status",
  input: EmptyInputSchema,
  output: StatusSchema,
});

export const downloadModelRpc = defineRpc({
  name: "voicevi.model.download",
  input: EmptyInputSchema,
  output: z.object({ started: z.boolean(), job: JobSchema }),
});

export const selfTestRpc = defineRpc({
  name: "voicevi.worker.self_test",
  input: EmptyInputSchema,
  output: z.object({ started: z.boolean(), job: JobSchema }),
});

export const applyConfigRpc = defineRpc({
  name: "voicevi.dictation.apply_config",
  input: ApplyConfigInputSchema,
  output: ApplyConfigResultSchema,
});
