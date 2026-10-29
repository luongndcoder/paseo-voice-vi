import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MODEL_ID,
  PLUGIN_ID,
  WORKER_FILE_NAME,
  type Status,
} from "../shared/contract";
import { VOICE_MODEL_ENV, voiceModelLabel } from "../shared/model";
import { resolveEffectiveModel } from "./selection";
import { jobSnapshot } from "./jobs";
import {
  getVietnameseDictationModelDirectory,
  resolveInstalledNemotronModelSync,
} from "./sherpa/vietnamese-model";

interface DaemonConfigShape {
  providers?: { local?: { modelsDir?: string } };
  features?: {
    dictation?: {
      enabled?: boolean;
      stt?: {
        provider?: string;
        language?: string;
        external?: { command?: string };
      };
    };
  };
  plugins?: Record<string, { path?: string; source?: string; enabled?: boolean }>;
}

export function resolvePaseoHome(): string {
  const fromEnv = process.env.PASEO_HOME?.trim();
  return fromEnv && fromEnv.length > 0 ? path.resolve(fromEnv) : path.join(os.homedir(), ".paseo");
}

export function resolveConfigPath(home = resolvePaseoHome()): string {
  return path.join(home, "config.json");
}

export function readDaemonConfig(configPath: string): {
  config: DaemonConfigShape | null;
  error: string | null;
} {
  try {
    const raw = readFileSync(configPath, "utf8");
    return { config: JSON.parse(raw) as DaemonConfigShape, error: null };
  } catch (error) {
    return {
      config: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isDirectory(target: string): boolean {
  try {
    return statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function looksLikePluginDirectory(directory: string): boolean {
  return isDirectory(directory) && existsSync(path.join(directory, "paseo-plugin.json"));
}

function managedPluginDirectory(home: string): string | null {
  const root = path.join(home, "plugins", PLUGIN_ID);
  if (!isDirectory(root)) return null;
  try {
    for (const entry of readdirSync(root)) {
      const candidate = path.join(root, entry, "checkout");
      if (looksLikePluginDirectory(candidate)) return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

export function resolvePluginDirectory(
  home: string,
  config: DaemonConfigShape | null,
): string | null {
  const configured = config?.plugins?.[PLUGIN_ID]?.path?.trim();
  if (configured && looksLikePluginDirectory(configured)) return path.resolve(configured);
  return managedPluginDirectory(home);
}

export function resolveModelsDir(home: string, config: DaemonConfigShape | null): string {
  const fromEnv = process.env.PASEO_LOCAL_MODELS_DIR?.trim();
  if (fromEnv && fromEnv.length > 0) return path.resolve(fromEnv);
  const fromConfig = config?.providers?.local?.modelsDir?.trim();
  if (fromConfig && fromConfig.length > 0) return path.resolve(fromConfig);
  return path.join(home, "models", "local-speech");
}

function hasModelFiles(directory: string): boolean {
  // The codeswitch trial model ships symlinks; statSync follows them.
  // Decoder is fp32 (decoder.onnx), encoder/joiner are int8.
  const encoderOk = ["encoder.int8.onnx", "encoder.onnx"].some((name) => isNonEmptyFile(directory, name));
  const decoderOk = ["decoder.onnx", "decoder.int8.onnx"].some((name) => isNonEmptyFile(directory, name));
  const joinerOk = ["joiner.int8.onnx", "joiner.onnx"].some((name) => isNonEmptyFile(directory, name));
  return encoderOk && decoderOk && joinerOk && isNonEmptyFile(directory, "tokens.txt");
}

function isNonEmptyFile(directory: string, name: string): boolean {
  try {
    const stat = statSync(path.join(directory, name));
    return stat.isFile() && stat.size > 0;
  } catch {
    return false;
  }
}

export function findInstalledModelDirectory(
  modelsDir: string,
  pluginDirectory: string | null,
): string | null {
  const candidates = [
    // Model bundled with this plugin.
    pluginDirectory ? path.join(pluginDirectory, "models", MODEL_ID) : undefined,
    path.join(modelsDir, MODEL_ID),
    path.join(os.homedir(), ".paseo", "models", "local-speech", MODEL_ID),
    path.join(os.homedir(), ".voicescribe", "models", MODEL_ID),
  ];
  for (const candidate of candidates) {
    if (candidate && hasModelFiles(candidate)) return candidate;
  }
  return null;
}

export function buildConfigSnippet(workerPath: string, language: string): string {
  return JSON.stringify(
    {
      features: {
        dictation: {
          enabled: true,
          stt: {
            provider: "external",
            language,
            external: { command: workerPath },
          },
        },
      },
    },
    null,
    2,
  );
}

export function collectStatus(): Status {
  const home = resolvePaseoHome();
  const configPath = resolveConfigPath(home);
  const { config, error } = readDaemonConfig(configPath);
  const pluginDirectory = resolvePluginDirectory(home, config);
  const workerPath = pluginDirectory ? path.join(pluginDirectory, "bin", WORKER_FILE_NAME) : null;
  const modelsDir = resolveModelsDir(home, config);
  const installedModel = findInstalledModelDirectory(modelsDir, pluginDirectory);

  const warnings: string[] = [];
  if (error) warnings.push(`Cannot read ${configPath}: ${error}`);

  const dictation = config?.features?.dictation;
  const stt = dictation?.stt;
  const command = stt?.external?.command?.trim() ?? null;
  const language = stt?.language?.trim() ?? null;
  let activeModelId: "codeswitch" | "nemotron" = "codeswitch";
  let selectionSource: "env" | "file" | "default" = "default";
  try {
    const effective = resolveEffectiveModel(home);
    activeModelId = effective.id;
    selectionSource = effective.source;
  } catch (cause) {
    warnings.push(cause instanceof Error ? cause.message : String(cause));
  }

  if (!pluginDirectory) {
    warnings.push(
      `This plugin is not listed in ${configPath} yet. Install it from the Plugins settings so the worker path resolves.`,
    );
  } else if (!workerPath || !existsSync(workerPath)) {
    warnings.push(`Worker entry is missing at ${workerPath ?? "(unknown)"}.`);
  }
  if (pluginDirectory && !existsSync(path.join(pluginDirectory, "node_modules", "sherpa-onnx-node"))) {
    warnings.push(
      "sherpa-onnx-node is not installed in the plugin directory. A Git install runs npm ci; for a local checkout run npm install.",
    );
  }
  if (!installedModel) {
    warnings.push(
      `The vi-en codeswitch model is not found. It downloads automatically on first use; ` +
        `for an offline copy, place "${MODEL_ID}" in ${modelsDir} or set PASEO_VOICE_VI_CODESWITCH_DIR.`,
    );
  }
  if (stt?.provider === "external" && command && workerPath && command !== workerPath) {
    warnings.push(`Dictation points at ${command} instead of ${workerPath}.`);
  }

  const nemotronInstalled = resolveInstalledNemotronModelSync(modelsDir);
  const nemotronDir =
    nemotronInstalled?.modelDir ?? getVietnameseDictationModelDirectory(modelsDir);
  if (activeModelId === "nemotron" && !nemotronInstalled) {
    warnings.push(
      `Nemotron model is selected (${VOICE_MODEL_ENV}=nemotron) but not downloaded yet. ` +
        `It downloads automatically (~650 MB) on first use.`,
    );
  }

  return {
    paseoHome: home,
    activeModelId,
    selectionSource,
    models: [
      {
        id: "codeswitch",
        label: voiceModelLabel("codeswitch"),
        installed: installedModel !== null,
        directory: installedModel ?? path.join(modelsDir, MODEL_ID),
      },
      {
        id: "nemotron",
        label: voiceModelLabel("nemotron"),
        installed: nemotronInstalled !== null,
        directory: nemotronDir,
      },
    ],
    configPath,
    configReadable: error === null,
    configError: error,
    pluginDirectory,
    workerPath,
    workerExists: Boolean(workerPath && existsSync(workerPath)),
    sherpaInstalled: Boolean(
      pluginDirectory && existsSync(path.join(pluginDirectory, "node_modules", "sherpa-onnx-node")),
    ),
    modelsDir,
    modelInstalled:
      activeModelId === "nemotron" ? nemotronInstalled !== null : installedModel !== null,
    modelDirectory:
      activeModelId === "nemotron"
        ? nemotronDir
        : (installedModel ?? path.join(modelsDir, MODEL_ID)),
    dictation: {
      enabled: dictation?.enabled === true,
      provider: stt?.provider?.trim() ?? null,
      language,
      command,
      commandMatchesWorker: Boolean(command && workerPath && command === workerPath),
    },
    configSnippet: buildConfigSnippet(workerPath ?? "<path>/bin/worker.mjs", language ?? "vi"),
    job: jobSnapshot(),
    warnings,
  };
}
