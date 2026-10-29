import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MODEL_ID, PLUGIN_ID, WORKER_FILE_NAME, type Status } from "../shared/contract";
import { jobSnapshot } from "./jobs";

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
  return ["encoder.int8.onnx", "decoder.int8.onnx", "joiner.int8.onnx", "tokens.txt"].every(
    (name) => {
      try {
        const stat = statSync(path.join(directory, name));
        return stat.isFile() && stat.size > 0;
      } catch {
        return false;
      }
    },
  );
}

export function findInstalledModelDirectory(modelsDir: string): string | null {
  const candidates = [
    path.join(modelsDir, MODEL_ID),
    path.join(os.homedir(), ".paseo", "models", "local-speech", MODEL_ID),
    path.join(os.homedir(), ".voicescribe", "models", MODEL_ID),
  ];
  for (const candidate of candidates) {
    if (hasModelFiles(candidate)) return candidate;
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
  const installedModel = findInstalledModelDirectory(modelsDir);

  const dictation = config?.features?.dictation;
  const stt = dictation?.stt;
  const command = stt?.external?.command?.trim() ?? null;
  const language = stt?.language?.trim() ?? null;

  const warnings: string[] = [];
  if (error) warnings.push(`Cannot read ${configPath}: ${error}`);
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
    warnings.push(`The Vietnamese model is not downloaded in ${modelsDir}.`);
  }
  if (stt?.provider === "external" && command && workerPath && command !== workerPath) {
    warnings.push(`Dictation points at ${command} instead of ${workerPath}.`);
  }

  return {
    paseoHome: home,
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
    modelInstalled: installedModel !== null,
    modelDirectory: installedModel ?? path.join(modelsDir, MODEL_ID),
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
