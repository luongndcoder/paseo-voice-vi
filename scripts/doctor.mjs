// Sanity check: sherpa-onnx-node loads, the selected model resolves,
// and its engine initializes. Exit code 0 = ready.
// Usage: node scripts/doctor.mjs [modelsDir]
// Model: PASEO_VOICE_VI_MODEL=codeswitch (default) | nemotron
import os from "node:os";
import path from "node:path";
import { logger } from "../server/logger.ts";
import { resolveActiveModelId } from "../shared/model.ts";
import {
  CODESWITCH_MODEL_ID,
  ensureCodeswitchModel,
  isCodeswitchModelInstalled,
  resolveInstalledCodeswitchModelSync,
} from "../server/sherpa/codeswitch-model.ts";
import { SherpaOnlineZipformerEngine } from "../server/sherpa/sherpa-online-zipformer-stt.ts";
import {
  ensureVietnameseDictationModel,
  isVietnameseDictationModelInstalled,
  resolveInstalledNemotronModelSync,
} from "../server/sherpa/vietnamese-model.ts";
import { SherpaOnlineNemotronEngine } from "../server/sherpa/sherpa-online-nemotron-stt.ts";

const modelsDir =
  process.argv[2] ?? path.join(os.homedir(), ".paseo", "models", "local-speech");

// Model bundled with this repo: <repoRoot>/models/<id>.
const repoRoot = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const extraDirs = [path.join(repoRoot, "models", CODESWITCH_MODEL_ID)];

const active = resolveActiveModelId();
console.log(`[doctor] modelsDir: ${modelsDir}`);
console.log(`[doctor] model: ${active}`);

if (active === "nemotron") {
  if (!(await isVietnameseDictationModelInstalled(modelsDir))) {
    console.log("[doctor] model missing; downloading ...");
  }
  const resolved = await ensureVietnameseDictationModel({ modelsDir, logger });
  console.log(`[doctor] model dir: ${resolved}`);
  const files = resolveInstalledNemotronModelSync(modelsDir);
  if (!files) throw new Error("Model resolved but files not found");
  const engine = new SherpaOnlineNemotronEngine(
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
  console.log("[doctor] sherpa-onnx Nemotron engine initialized OK");
  engine.free();
} else {
  if (!(await isCodeswitchModelInstalled(modelsDir, extraDirs))) {
    console.log("[doctor] model missing; resolving ...");
  }
  const resolved = await ensureCodeswitchModel({ modelsDir, extraDirs, logger });
  console.log(`[doctor] model dir: ${resolved}`);
  const files = resolveInstalledCodeswitchModelSync(modelsDir, extraDirs);
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
}
console.log("[doctor] paseo-voice-vi is ready");
