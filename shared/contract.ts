import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const PLUGIN_ID = "paseo-voice-vi";
export const WORKER_FILE_NAME = "worker.mjs";
export const MODEL_ID = "nemotron-3.5-560ms-int8";

export const JobSchema = z.object({
  id: z.string(),
  kind: z.enum(["download-model", "self-test"]),
  state: z.enum(["running", "succeeded", "failed"]),
  message: z.string(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
});
export type Job = z.infer<typeof JobSchema>;

export const StatusSchema = z.object({
  paseoHome: z.string(),
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
