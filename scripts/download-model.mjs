// Resolve the vi-en codeswitch Zipformer model (custom build, no download URL).
// Usage: node scripts/download-model.mjs [modelsDir]
//        modelsDir defaults to ~/.paseo/models/local-speech
import os from "node:os";
import path from "node:path";
import { logger } from "../server/logger.ts";
import {
  ensureCodeswitchModel,
  isCodeswitchModelInstalled,
} from "../server/sherpa/codeswitch-model.ts";

const modelsDir =
  process.argv[2] ?? path.join(os.homedir(), ".paseo", "models", "local-speech");

if (await isCodeswitchModelInstalled(modelsDir)) {
  console.log(`[paseo-voice-vi] Codeswitch model already installed for ${modelsDir}`);
} else {
  console.log(`[paseo-voice-vi] Resolving codeswitch model ...`);
  const modelDir = await ensureCodeswitchModel({ modelsDir, logger });
  console.log(`[paseo-voice-vi] Model ready at ${modelDir}`);
}
process.exit(0);
