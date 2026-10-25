/** Minimal pino-shaped logger so the ported modules keep their call sites unchanged. */

type LogArgs = unknown[];

function emit(level: string, args: LogArgs): void {
  if (process.env.PASEO_VOICE_VI_LOG_LEVEL === "debug" || level !== "debug") {
    const line = args
      .map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg)))
      .join(" ");
    const write = level === "error" || level === "warn" ? console.error : console.log;
    write(`[paseo-voice-vi] ${level}: ${line}`);
  }
}

export interface VoiceViLogger {
  level: string;
  info: (...args: LogArgs) => void;
  warn: (...args: LogArgs) => void;
  error: (...args: LogArgs) => void;
  debug: (...args: LogArgs) => void;
  child: (bindings: Record<string, unknown>) => VoiceViLogger;
}

function createLogger(bindings: Record<string, unknown> = {}): VoiceViLogger {
  return {
    level: process.env.PASEO_VOICE_VI_LOG_LEVEL ?? "info",
    info: (...args: LogArgs) => emit("info", args),
    warn: (...args: LogArgs) => emit("warn", args),
    error: (...args: LogArgs) => emit("error", args),
    debug: (...args: LogArgs) => emit("debug", args),
    child: (extra: Record<string, unknown>) =>
      createLogger({ ...bindings, ...extra }),
  };
}

export const logger: VoiceViLogger = createLogger({ component: "paseo-voice-vi" });
