// Resolve the selected model into the daemon's models dir.
// Usage: node scripts/download-model.mjs [modelsDir]
//        modelsDir defaults to ~/.paseo/models/local-speech
// Model: PASEO_VOICE_VI_MODEL=codeswitch (default, bundled) | nemotron (~650 MB download)
import os from "node:os";
import path from "node:path";
import { logger } from "../server/logger.ts";
import { resolveActiveModelId } from "../shared/contract.ts";
import {
  CODESWITCH_MODEL_ID,
  ensureCodeswitchModel,
  isCodeswitchModelInstalled,
} from "../server/sherpa/codeswitch-model.ts";
import {
  ensureVietnameseDictationModel,
  isVietnameseDictationModelInstalled,
} from "../server/sherpa/vietnamese-model.ts";

const modelsDir =
  process.argv[2] ?? path.join(os.homedir(), ".paseo", "models", "local-speech");

// Model bundled with this repo: <repoRoot>/models/<id>.
const repoRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const extraDirs = [path.join(repoRoot, "models", CODESWITCH_MODEL_ID)];

const active = resolveActiveModelId();
if (active === "nemotron") {
  if (await isVietnameseDictationModelInstalled(modelsDir)) {
    console.log(`[paseo-voice-vi] Nemotron model already installed for ${modelsDir}`);
  } else {
    console.log(`[paseo-voice-vi] Downloading Nemotron model ...`);
    const modelDir = await ensureVietnameseDictationModel({ modelsDir, logger });
    console.log(`[paseo-voice-vi] Model ready at ${modelDir}`);
  }
} else {
  if (await isCodeswitchModelInstalled(modelsDir, extraDirs)) {
    console.log(`[paseo-voice-vi] Codeswitch model already installed for ${modelsDir}`);
  } else {
    console.log(`[paseo-voice-vi] Resolving codeswitch model ...`);
    const modelDir = await ensureCodeswitchModel({ modelsDir, extraDirs, logger });
    console.log(`[paseo-voice-vi] Model ready at ${modelDir}`);
  }
}
process.exit(0);
