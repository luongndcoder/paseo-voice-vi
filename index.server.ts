import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  applyConfigRpc,
  downloadModelRpc,
  selectModelRpc,
  selfTestRpc,
  statusRpc,
} from "./shared/contract";
import { collectStatus } from "./server/environment";
import { isJobRunning, jobSnapshot, runJob } from "./server/jobs";
import {
  applyDictationConfigOperation,
  downloadModelOperation,
  selectModelOperation,
  selfTestOperation,
} from "./server/operations";

export default function contribute(server: PluginServerContext) {
  server.handle(statusRpc, () => collectStatus());

  server.handle(downloadModelRpc, async () => {
    if (isJobRunning()) return { started: false, job: jobSnapshot()! };
    void runJob("download-model", downloadModelOperation);
    const job = jobSnapshot()!;
    return { started: true, job };
  });

  server.handle(selfTestRpc, async () => {
    if (isJobRunning()) return { started: false, job: jobSnapshot()! };
    void runJob("self-test", selfTestOperation);
    const job = jobSnapshot()!;
    return { started: true, job };
  });

  server.handle(selectModelRpc, async ({ id }) => {
    if (isJobRunning()) return { started: false, job: jobSnapshot()! };
    void runJob("download-model", (update) => selectModelOperation(id, update));
    const job = jobSnapshot()!;
    return { started: true, job };
  });

  server.handle(applyConfigRpc, async ({ language }) => {
    const result = await applyDictationConfigOperation(language);
    return { ...result, reloadRequired: true };
  });

  return () => {};
}
