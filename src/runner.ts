import { createTrialIdentity } from "./identity.ts";
import type { DeferredExecution, TrialSpec } from "./types.ts";

export function runDeferredTrial(trial: TrialSpec): DeferredExecution {
  return {
    trialId: createTrialIdentity(trial),
    status: "not_implemented",
    reason: "provider execution is deferred in the migration shell",
  };
}
