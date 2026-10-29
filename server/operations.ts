import { fork } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { logger } from "./logger.ts";
import {
  codeswitchModelDownloadHint,
  ensureCodeswitchModel,
  CODESWITCH_MODEL_ID,
} from "./sherpa/codeswitch-model.ts";
import { ensureVietnameseDictationModel } from "./sherpa/vietnamese-model.ts";
import { resolveActiveModelId } from "../shared/contract.ts";
import {
  readDaemonConfig,
  resolveConfigPath,
  resolveModelsDir,
  resolvePaseoHome,
  resolvePluginDirectory,
} from "./environment.ts";

function requirePluginWorker(): { pluginDirectory: string; workerPath: string } {
  const home = resolvePaseoHome();
  const { config } = readDaemonConfig(resolveConfigPath(home));
  const pluginDirectory = resolvePluginDirectory(home, config);
  if (!pluginDirectory) {
    throw new Error("Cannot locate this plugin directory. Reinstall the plugin, then retry.");
  }
  const workerPath = path.join(pluginDirectory, "bin", "worker.mjs");
  if (!existsSync(workerPath)) {
    throw new Error(`Worker entry missing at ${workerPath}.`);
  }
  return { pluginDirectory, workerPath };
}

export async function downloadModelOperation(update: (message: string) => void): Promise<string> {
  const home = resolvePaseoHome();
  const configPath = resolveConfigPath(home);
  const { config } = readDaemonConfig(configPath);
  const modelsDir = resolveModelsDir(home, config);
  const pluginDirectory = resolvePluginDirectory(home, config);
  const extraDirs = pluginDirectory
    ? [path.join(pluginDirectory, "models", CODESWITCH_MODEL_ID)]
    : [];
  update(`Resolving vi-en codeswitch model…`);
  try {
    const active = resolveActiveModelId();
    const modelDir =
      active === "nemotron"
        ? await ensureVietnameseDictationModel({ modelsDir, logger })
        : await ensureCodeswitchModel({ modelsDir, extraDirs, logger });
    return `Model ready at ${modelDir}`;
  } catch (error) {
    throw new Error(
      `${error instanceof Error ? error.message : String(error)} ${codeswitchModelDownloadHint(modelsDir)}`,
    );
  }
}

export async function selfTestOperation(update: (message: string) => void): Promise<string> {
  const { workerPath } = requirePluginWorker();
  const home = resolvePaseoHome();
  const { config } = readDaemonConfig(resolveConfigPath(home));
  const modelsDir = resolveModelsDir(home, config);

  update(`Forking ${workerPath}…`);
  const child = fork(workerPath, [], {
    serialization: "advanced",
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const stderr: string[] = [];
  child.stderr?.on("data", (chunk: Buffer) => {
    const text = String(chunk);
    if (stderr.join("").length < 4000) stderr.push(text);
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out waiting for worker responses (180s).")), 180_000);
      let settled = false;
      const done = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      child.on("message", (message: Record<string, unknown>) => {
        if (message?.type === "session.error") {
          done(new Error(`Worker session error: ${String(message.error ?? "unknown")}`));
          return;
        }
        if (message?.type !== "response") return;
        const requestId = message.requestId as string | undefined;
        if (requestId === "create") {
          if (!message.ok) {
            done(new Error(`session.create failed: ${String(message.error ?? "unknown")}`));
            return;
          }
          const sampleRate =
            typeof message.result === "object" && message.result !== null
              ? Number((message.result as { requiredSampleRate?: unknown }).requiredSampleRate) || 16000
              : 16000;
          update(`Session ready (sample rate ${sampleRate} Hz), sending 1s of silence…`);
          child.send({ type: "session.append", requestId: "append", sessionId: "s1", audio: Buffer.alloc(sampleRate * 2) });
          return;
        }
        if (requestId === "append") {
          if (!message.ok) {
            done(new Error(`session.append failed: ${String(message.error ?? "unknown")}`));
            return;
          }
          child.send({ type: "session.commit", requestId: "commit", sessionId: "s1" });
          return;
        }
        if (requestId === "commit") {
          if (!message.ok) {
            done(new Error(`session.commit failed: ${String(message.error ?? "unknown")}`));
            return;
          }
          child.send({ type: "session.close", requestId: "close", sessionId: "s1" });
          return;
        }
        if (requestId === "close") {
          if (!message.ok) {
            done(new Error(`session.close failed: ${String(message.error ?? "unknown")}`));
            return;
          }
          update("Protocol round-trip complete.");
          done();
        }
      });
      child.on("error", (error) => done(error));
      child.on("exit", (code) => {
        if (!settled && code !== 0 && code !== null) {
          done(new Error(`Worker exited with code ${code}. ${stderr.join("").trim()}`));
        }
      });
      child.send({
        type: "session.create",
        requestId: "create",
        sessionId: "s1",
        kind: "dictationStt",
        config: { modelsDir, dictationLanguage: "vi" },
      });
    });
    return `Worker protocol round-trip passed (${workerPath}).`;
  } finally {
    if (!child.killed) {
      try {
        child.kill();
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Best-effort daemon version detection. The plugin subprocess is forked from
 * <daemon>/dist/server/plugins/plugin-process.{js,ts}, so walking up from
 * argv[1] finds the daemon's package.json. Returns null when unreadable.
 */
function readDaemonVersion(): string | null {
  try {
    const childPath = process.argv[1];
    if (!childPath) return null;
    let dir = path.dirname(childPath);
    for (let i = 0; i < 8; i++) {
      try {
        const pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8")) as {
          name?: unknown;
          version?: unknown;
        };
        if (pkg?.name === "@getpaseo/server" && typeof pkg.version === "string") {
          return pkg.version;
        }
      } catch {
        // keep walking up
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch {
    // ignore
  }
  return null;
}

function daemonSupportsExternalDictation(): { ok: boolean; version: string | null } {
  const version = readDaemonVersion();
  if (!version) return { ok: true, version };
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return { ok: true, version };
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return { ok: major > 0 || minor >= 13, version };
}

export interface ApplyConfigResult {
  configPath: string;
  backupPath: string;
  command: string;
}

export async function applyDictationConfigOperation(language: string): Promise<ApplyConfigResult> {
  const support = daemonSupportsExternalDictation();
  if (!support.ok) {
    throw new Error(
      `This daemon (${support.version ?? "unknown version"}) does not support external dictation ` +
        `(needs a Paseo fork with stt.provider "external", 0.13+). ` +
        `Upgrade the daemon instead of editing the config: a stock daemon rejects this file and ` +
        `blocks its own config management until the external block is removed by hand.`,
    );
  }
  const { workerPath } = requirePluginWorker();
  const home = resolvePaseoHome();
  const configPath = resolveConfigPath(home);
  if (!existsSync(configPath)) {
    throw new Error(`Daemon config not found at ${configPath}.`);
  }
  const raw = readFileSync(configPath, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`Cannot parse ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const backupPath = `${configPath}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  copyFileSync(configPath, backupPath);

  const features = (parsed.features ?? {}) as Record<string, unknown>;
  features.dictation = {
    enabled: true,
    stt: {
      provider: "external",
      language,
      external: { command: workerPath },
    },
  };
  parsed.features = features;
  writeFileSync(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  logger.info({ configPath, backupPath }, "Applied external dictation STT config");
  return { configPath, backupPath, command: workerPath };
}
