import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { copyText, useToast } from "@getpaseo/plugin/client/ui";
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
  return { status, error, loading, refresh, setStatus };
}

function Row({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <View style={{ flexDirection: "row", gap: 8, paddingVertical: 2 }}>
      <Text style={{ flex: 1, opacity: 0.7 }}>{label}</Text>
      <Text style={{ flex: 2, fontWeight: ok === false ? "600" : "400" }}>{value}</Text>
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
    card: {
      backgroundColor: theme.colors.surface1,
      borderRadius: 10,
      padding: 12,
      gap: 4 as const,
    },
    button: {
      padding: 12,
      borderRadius: 10,
      backgroundColor: theme.colors.accent,
    },
    buttonText: { color: theme.colors.accentForeground, textAlign: "center" as const, fontWeight: "600" as const },
    secondaryButton: {
      padding: 12,
      borderRadius: 10,
      backgroundColor: theme.colors.surface2,
    },
    secondaryText: { color: theme.colors.foreground, textAlign: "center" as const, fontWeight: "600" as const },
    code: {
      color: theme.colors.foreground,
      fontSize: 12,
      fontFamily: "monospace" as const,
      backgroundColor: theme.colors.surface2,
      borderRadius: 8,
      padding: 10,
    },
  };

  const run = useCallback(
    async (kind: "download" | "self-test" | "apply" | "copy", fn: () => Promise<unknown>) => {
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

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View style={styles.screen}>
        <Text style={styles.title}>Vietnamese voice</Text>
        <Text style={styles.muted}>
          On-device Vietnamese dictation (sherpa-onnx Nemotron streaming). This screen checks the
          worker, downloads the model, self-tests the IPC protocol, and writes the daemon dictation
          config.
        </Text>

        {error ? <Text style={{ color: theme.colors.statusDanger }}>Status failed: {error}</Text> : null}
        {loading && !status ? <Text style={styles.muted}>Loading status…</Text> : null}

        {status ? (
          <View style={{ gap: 12 }}>
            <View style={styles.card}>
              <Row label="Worker" value={status.workerPath ?? "not resolved"} ok={status.workerExists} />
              <Row label="sherpa-onnx" value={status.sherpaInstalled ? "installed" : "missing"} ok={status.sherpaInstalled} />
              <Row label="Model" value={status.modelInstalled ? status.modelDirectory : `missing (${status.modelsDir})`} ok={status.modelInstalled} />
              <Row
                label="Dictation"
                value={
                  status.dictation.provider
                    ? `${status.dictation.enabled ? "enabled" : "disabled"} · ${status.dictation.provider} · ${status.dictation.language ?? "?"}`
                    : "not configured"
                }
                ok={status.dictation.provider === "external" && status.dictation.commandMatchesWorker}
              />
              <Row label="Config" value={status.configPath} />
            </View>

            {status.warnings.length > 0 ? (
              <View style={styles.card}>
                <Text style={{ ...styles.body, fontWeight: "600" }}>Warnings</Text>
                {status.warnings.map((warning) => (
                  <Text key={warning} style={styles.muted}>
                    {"• "}
                    {warning}
                  </Text>
                ))}
              </View>
            ) : null}

            {status.job ? (
              <View style={styles.card}>
                <Text style={{ ...styles.body, fontWeight: "600" }}>
                  {status.job.kind === "download-model" ? "Model download" : "Worker self-test"}: {status.job.state}
                </Text>
                <Text style={styles.muted}>{status.job.message}</Text>
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={{ ...styles.body, fontWeight: "600" }}>Config snippet</Text>
              <Text style={styles.muted}>Applied by “Apply dictation config”. Restart the daemon after applying.</Text>
              <Text style={styles.code}>{status.configSnippet}</Text>
            </View>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh status"
          onPress={() => void run("copy", async () => refresh())}
          style={styles.secondaryButton}
          disabled={busy !== null}
        >
          <Text style={styles.secondaryText}>{busy ? "Working…" : "Refresh status"}</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Download Vietnamese model"
          onPress={() =>
            void run("download", async () => {
              const result = await startDownload({});
              if (!result.started) toast.show("A job is already running.");
            })
          }
          style={styles.button}
          disabled={busy !== null}
        >
          <Text style={styles.buttonText}>Download Vietnamese model (~200 MB)</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Run worker self-test"
          onPress={() =>
            void run("self-test", async () => {
              const result = await startSelfTest({});
              if (!result.started) toast.show("A job is already running.");
            })
          }
          style={styles.secondaryButton}
          disabled={busy !== null}
        >
          <Text style={styles.secondaryText}>Run worker self-test</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Apply dictation config"
          onPress={() =>
            void run("apply", async () => {
              const result = await applyConfig({ language: status?.dictation.language ?? "vi" });
              toast.show(`Config written (backup: ${result.backupPath}). Restart the daemon.`);
            })
          }
          style={styles.button}
          disabled={busy !== null}
        >
          <Text style={styles.buttonText}>Apply dictation config</Text>
        </Pressable>

        {status ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Copy config snippet"
            onPress={() =>
              void run("copy", async () => {
                await copyText(status.configSnippet);
                toast.show("Config snippet copied.");
              })
            }
            style={styles.secondaryButton}
            disabled={busy !== null}
          >
            <Text style={styles.secondaryText}>Copy config snippet</Text>
          </Pressable>
        ) : null}
      </View>
    </ScrollView>
  );
}
