// Sanity check: sherpa-onnx-node loads, the vi-en codeswitch model resolves,
// and the Zipformer engine initializes. Exit code 0 = ready.
// Usage: node scripts/doctor.mjs [modelsDir]
import os from "node:os";
import path from "node:path";
import { logger } from "../server/logger.ts";
import {
  ensureCodeswitchModel,
  isCodeswitchModelInstalled,
  resolveInstalledCodeswitchModelSync,
} from "../server/sherpa/codeswitch-model.ts";
import { SherpaOnlineZipformerEngine } from "../server/sherpa/sherpa-online-zipformer-stt.ts";

const modelsDir =
  process.argv[2] ?? path.join(os.homedir(), ".paseo", "models", "local-speech");

console.log(`[doctor] modelsDir: ${modelsDir}`);
if (!(await isCodeswitchModelInstalled(modelsDir))) {
  console.log("[doctor] model missing; resolving ...");
}
const resolved = await ensureCodeswitchModel({ modelsDir, logger });
console.log(`[doctor] model dir: ${resolved}`);

const files = resolveInstalledCodeswitchModelSync(modelsDir);
if (!files) throw new Error("Model resolved but files not found");
const engine = new SherpaOnlineZipformerEngine(
  {
    modelDir: files.modelDir,
    encoderPath: files.encoderPath,
    decoderPath: files.decoderPath,
    joinerPath: files.joinerPath,
    tokensPath: files.tokensPath,
    numThreads: 2,
  },
  logger,
);
console.log("[doctor] sherpa-onnx Zipformer engine initialized OK");
engine.free();
console.log("[doctor] paseo-voice-vi is ready");
