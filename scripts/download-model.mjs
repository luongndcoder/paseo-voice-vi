// Pre-download the Vietnamese Nemotron streaming model into the daemon's models dir.
// Usage: node scripts/download-model.mjs [modelsDir]
//        modelsDir defaults to ~/.paseo/models/local-speech
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { logger } from "../src/logger.ts";
import { ensureVietnameseDictationModel, isVietnameseDictationModelInstalled } from "../src/sherpa/vietnamese-model.ts";

const modelsDir =
  process.argv[2] ?? path.join(os.homedir(), ".paseo", "models", "local-speech");

if (await isVietnameseDictationModelInstalled(modelsDir)) {
  console.log(`[paseo-voice-vi] Vietnamese model already installed in ${modelsDir}`);
} else {
  console.log(`[paseo-voice-vi] Downloading Vietnamese model into ${modelsDir} ...`);
  const modelDir = await ensureVietnameseDictationModel({ modelsDir, logger });
  console.log(`[paseo-voice-vi] Model ready at ${modelDir}`);
}
process.exit(0);
