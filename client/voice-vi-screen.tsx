import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/react-native";
import {
  applyConfigRpc,
  downloadModelRpc,
  selfTestRpc,
  statusRpc,
  type Status,
} from "../shared/contract";

function useStatus() {
  const getStatus = useRpc(statusRpc);
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await getStatus({}));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, [getStatus]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (status?.job?.state !== "running") return;
    const timer = setInterval(() => {
      void refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [status?.job?.state, refresh]);
  return { status, error, loading, refresh };
}

function shortName(path: string | null): string {
  if (!path) return "Not found";
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function StepDot({ done, theme }: { done: boolean; theme: { colors: { statusSuccess: string; foregroundMuted: string } } }) {
  return (
    <View
      style={{
        width: 22,
        height: 22,
        borderRadius: 11,
        backgroundColor: done ? theme.colors.statusSuccess : "transparent",
        borderWidth: done ? 0 : 2,
        borderColor: done ? "transparent" : theme.colors.foregroundMuted,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {done ? <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>✓</Text> : null}
    </View>
  );
}

export function VoiceViScreen({ theme, layout }: PluginScreenProps) {
  const toast = useToast();
  const { status, error, loading, refresh } = useStatus();
  const startDownload = useRpc(downloadModelRpc);
  const startSelfTest = useRpc(selfTestRpc);
  const applyConfig = useRpc(applyConfigRpc);
  const [busy, setBusy] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);

  const styles = {
    screen: {
      flex: 1 as const,
      padding: layout.compact ? 16 : 24,
      gap: 12 as const,
      backgroundColor: theme.colors.surface0,
    },
    title: { color: theme.colors.foreground, fontSize: layout.compact ? 20 : 24, fontWeight: "700" as const },
    body: { color: theme.colors.foreground, fontSize: 14 },
    muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
    tiny: { color: theme.colors.foregroundMuted, fontSize: 12 },
    card: { backgroundColor: theme.colors.surface1, borderRadius: 12, padding: 14, gap: 8 as const },
    heroReady: {
      backgroundColor: theme.colors.surface1,
      borderRadius: 12,
      padding: 16,
      gap: 4 as const,
      borderLeftWidth: 4 as const,
      borderLeftColor: theme.colors.statusSuccess,
    },
    heroTodo: {
      backgroundColor: theme.colors.surface1,
      borderRadius: 12,
      padding: 16,
      gap: 4 as const,
      borderLeftWidth: 4 as const,
      borderLeftColor: theme.colors.statusWarning,
    },
    heroTitle: { color: theme.colors.foreground, fontSize: 17, fontWeight: "700" as const },
    stepRow: { flexDirection: "row" as const, gap: 10 as const, alignItems: "flex-start" as const },
    stepBody: { flex: 1 as const, gap: 2 as const },
    stepTitle: { color: theme.colors.foreground, fontSize: 14, fontWeight: "600" as const },
    button: { padding: 13, borderRadius: 10, backgroundColor: theme.colors.accent },
    buttonText: { color: theme.colors.accentForeground, textAlign: "center" as const, fontWeight: "600" as const },
    secondaryButton: { padding: 12, borderRadius: 10, backgroundColor: theme.colors.surface2 },
    secondaryText: { color: theme.colors.foreground, textAlign: "center" as const, fontWeight: "600" as const },
    code: {
      color: theme.colors.foreground,
      fontSize: 11,
      fontFamily: "monospace" as const,
      backgroundColor: theme.colors.surface2,
      borderRadius: 8,
      padding: 10,
    },
  };

  const run = useCallback(
    async (kind: string, fn: () => Promise<unknown>) => {
      setBusy(kind);
      try {
        await fn();
        await refresh();
      } catch (cause) {
        toast.error(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [refresh, toast],
  );

  const modelOk = Boolean(status && status.modelInstalled && status.workerExists && status.sherpaInstalled);
  const activeModel = status?.models.find((m) => m.id === status.activeModelId) ?? null;
  const testOk = status?.job?.kind === "self-test" && status.job.state === "succeeded";
  const configOk = Boolean(
    status?.dictation.enabled &&
      status.dictation.provider === "external" &&
      status.dictation.commandMatchesWorker,
  );
  const ready = modelOk && testOk && configOk;
  const jobRunning = status?.job?.state === "running";

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View style={styles.screen}>
        <Text style={styles.title}>Vietnamese voice</Text>
        <Text style={styles.muted}>
          Dictate Vietnamese and English on this Mac, offline. Text appears when you release the
          microphone.
        </Text>

        {error ? <Text style={{ color: theme.colors.statusDanger }}>Could not load status: {error}</Text> : null}
        {loading && !status ? <Text style={styles.muted}>Checking setup…</Text> : null}

        {status ? (
          <View style={ready ? styles.heroReady : styles.heroTodo}>
            <Text style={styles.heroTitle}>{ready ? "Ready to dictate" : "Setup needed"}</Text>
            <Text style={styles.muted}>
              {ready
                ? "Press the microphone and speak. Vietnamese and English are both recognized."
                : "Complete the steps below, then restart the Paseo daemon."}
            </Text>
          </View>
        ) : null}

        {status ? (
          <View style={styles.card}>
            <View style={styles.stepRow}>
              <StepDot done={modelOk} theme={theme} />
              <View style={styles.stepBody}>
                <Text style={styles.stepTitle}>1. Speech model</Text>
                <Text style={styles.muted}>
                  {modelOk && activeModel
                    ? `${activeModel.label} is ready.`
                    : "The voice model was not found on this machine."}
                </Text>
                <Text style={styles.tiny}>
                  Switch model: set PASEO_VOICE_VI_MODEL to “codeswitch” or “nemotron” in the
                  daemon environment, then restart the daemon.
                </Text>
                {!modelOk ? (
                  <View style={{ marginTop: 8 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Find the voice model"
                      onPress={() =>
                        void run("model", async () => {
                          const result = await startDownload({});
                          if (!result.started) toast.show("A task is already running.");
                          else if (result.job.state === "failed") throw new Error(result.job.message);
                        })
                      }
                      style={styles.button}
                      disabled={busy !== null || jobRunning}
                    >
                      <Text style={styles.buttonText}>
                        {busy === "model" || jobRunning ? "Working…" : "Find the voice model"}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.stepRow}>
              <StepDot done={testOk} theme={theme} />
              <View style={styles.stepBody}>
                <Text style={styles.stepTitle}>2. Microphone pipeline test</Text>
                <Text style={styles.muted}>
                  {testOk
                    ? "Last test passed."
                    : "Runs the voice engine once to make sure it works."}
                </Text>
                {!testOk ? (
                  <View style={{ marginTop: 8 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Run the pipeline test"
                      onPress={() =>
                        void run("test", async () => {
                          const result = await startSelfTest({});
                          if (!result.started) toast.show("A task is already running.");
                        })
                      }
                      style={modelOk ? styles.button : styles.secondaryButton}
                      disabled={busy !== null || jobRunning || !modelOk}
                    >
                      <Text style={modelOk ? styles.buttonText : styles.secondaryText}>
                        {busy === "test" || jobRunning ? "Working…" : "Run the test"}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </View>

            <View style={styles.stepRow}>
              <StepDot done={configOk} theme={theme} />
              <View style={styles.stepBody}>
                <Text style={styles.stepTitle}>3. Connect dictation</Text>
                <Text style={styles.muted}>
                  {configOk
                    ? "Paseo is connected to the voice engine."
                    : "Point Paseo dictation at the voice engine, then restart the daemon."}
                </Text>
                <Text style={styles.tiny}>
                  Needs a Paseo daemon with external dictation support (fork 0.13+). Stock
                  Paseo rejects this config.
                </Text>
                {!configOk ? (
                  <View style={{ marginTop: 8 }}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Connect dictation"
                      onPress={() =>
                        void run("apply", async () => {
                          const result = await applyConfig({
                            language: status?.dictation.language ?? "vi",
                          });
                          toast.show("Connected. Restart the Paseo daemon to finish.");
                          void result;
                        })
                      }
                      style={modelOk && testOk ? styles.button : styles.secondaryButton}
                      disabled={busy !== null || jobRunning || !modelOk}
                    >
                      <Text style={modelOk && testOk ? styles.buttonText : styles.secondaryText}>
                        {busy === "apply" ? "Working…" : "Connect dictation"}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            </View>

            {status.job && status.job.state !== "succeeded" ? (
              <Text style={styles.muted}>
                Last task ({status.job.kind === "download-model" ? "find model" : "pipeline test"}):{" "}
                {status.job.state} — {status.job.message}
              </Text>
            ) : null}
            {status.warnings.length > 0 ? (
              <View style={{ gap: 2 }}>
                {status.warnings.map((warning) => (
                  <Text key={warning} style={styles.tiny}>
                    {"• "}
                    {warning}
                  </Text>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show technical details"
          onPress={() => setShowDetails((value) => !value)}
          style={styles.secondaryButton}
        >
          <Text style={styles.secondaryText}>
            {showDetails ? "Hide technical details" : "Show technical details"}
          </Text>
        </Pressable>

        {showDetails && status ? (
          <View style={styles.card}>
            <Text style={styles.tiny}>Worker: {status.workerPath ?? "not found"}</Text>
            {status.models.map((model) => (
              <Text key={model.id} style={styles.tiny}>
                {model.id === status.activeModelId ? "● " : "○ "}
                {model.label}: {model.installed ? model.directory : "not downloaded"}
              </Text>
            ))}
            <Text style={styles.tiny}>Config: {status.configPath}</Text>
            <Text style={styles.code}>{status.configSnippet}</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Copy config"
              onPress={() =>
                void run("copy", async () => {
                  await copyText(status.configSnippet);
                  toast.show("Config copied.");
                })
              }
              style={styles.secondaryButton}
              disabled={busy !== null}
            >
              <Text style={styles.secondaryText}>Copy config</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Refresh status"
              onPress={() => void run("refresh", refresh)}
              style={styles.secondaryButton}
              disabled={busy !== null}
            >
              <Text style={styles.secondaryText}>Refresh status</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}
