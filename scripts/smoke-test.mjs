// End-to-end smoke test of the worker protocol: fork the worker, create a dictation session,
// append one second of PCM16 silence, commit, and expect the protocol round-trip to answer.
// Exit code 0 = the worker speaks the protocol. Usage: node scripts/smoke-test.mjs [modelsDir]
import { fork } from "node:child_process";
import os from "node:os";
import path from "node:path";

const modelsDir =
  process.argv[2] ?? path.join(os.homedir(), ".paseo", "models", "local-speech");

const child = fork(new URL("../bin/worker.mjs", import.meta.url), [], {
  serialization: "advanced",
  stdio: ["ignore", "inherit", "inherit", "ipc"],
});

let done = false;
function fail(message) {
  console.error(`[smoke-test] FAIL: ${message}`);
  child.kill();
  process.exit(1);
}

const timeout = setTimeout(() => {
  if (!done) fail("timed out waiting for worker responses");
}, 120_000);

child.on("message", (message) => {
  if (message.type === "session.transcript") {
    console.log(`[smoke-test] partial: ${JSON.stringify(message.payload?.transcript ?? "")}`);
    return;
  }
  if (message.type === "session.error") {
    fail(`session error: ${message.error}`);
    return;
  }
  if (message.type !== "response") return;

  if (message.requestId === "create") {
    if (!message.ok) fail(`session.create failed: ${message.error}`);
    console.log(`[smoke-test] session ready, requiredSampleRate=${message.result?.requiredSampleRate}`);
    const sampleRate = message.result?.requiredSampleRate ?? 16000;
    const silence = Buffer.alloc(sampleRate * 2); // 1s of PCM16 silence
    child.send({ type: "session.append", requestId: "append", sessionId: "s1", audio: silence });
    return;
  }
  if (message.requestId === "append") {
    if (!message.ok) fail(`session.append failed: ${message.error}`);
    child.send({ type: "session.commit", requestId: "commit", sessionId: "s1" });
    return;
  }
  if (message.requestId === "commit") {
    if (!message.ok) fail(`session.commit failed: ${message.error}`);
    child.send({ type: "session.close", requestId: "close", sessionId: "s1" });
    return;
  }
  if (message.requestId === "close") {
    if (!message.ok) fail(`session.close failed: ${message.error}`);
    done = true;
    clearTimeout(timeout);
    console.log("[smoke-test] PASS: worker protocol round-trip complete");
    child.kill();
    process.exit(0);
  }
});

child.send({
  type: "session.create",
  requestId: "create",
  sessionId: "s1",
  kind: "dictationStt",
  config: { modelsDir, dictationLanguage: "vi" },
});
