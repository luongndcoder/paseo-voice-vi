// Sanity check: sherpa-onnx-node loads, the Vietnamese model resolves, and a worker session
// can be created. Exit code 0 = ready. Usage: node scripts/doctor.mjs [modelsDir]
import os from "node:os";
import path from "node:path";
import { logger } from "../server/logger.ts";
import {
  ensureVietnameseDictationModel,
  isVietnameseDictationModelInstalled,
} from "../server/sherpa/vietnamese-model.ts";
import { SherpaOnlineNemotronEngine } from "../server/sherpa/sherpa-online-nemotron-stt.ts";

const modelsDir =
  process.argv[2] ?? path.join(os.homedir(), ".paseo", "models", "local-speech");

console.log(`[doctor] modelsDir: ${modelsDir}`);
if (!(await isVietnameseDictationModelInstalled(modelsDir))) {
  console.log("[doctor] model missing; downloading ...");
  await ensureVietnameseDictationModel({ modelsDir, logger });
}
const resolved = await ensureVietnameseDictationModel({ modelsDir, logger });
console.log(`[doctor] model dir: ${resolved}`);

const engine = new SherpaOnlineNemotronEngine({ modelDir: resolved, numThreads: 2 }, logger);
console.log("[doctor] sherpa-onnx engine initialized OK");
engine.free();
console.log("[doctor] paseo-voice-vi is ready");
