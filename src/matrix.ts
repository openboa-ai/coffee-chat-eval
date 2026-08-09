import { createTrialIdentity } from "./identity.ts";
import type { MatrixDefinition, TrialSpec } from "./types.ts";

export function expandMatrix(definition: MatrixDefinition): readonly TrialSpec[] {
  if (!Number.isInteger(definition.repetitions) || definition.repetitions < 1) {
    throw new Error("repetitions must be a positive integer");
  }
  const trials: TrialSpec[] = [];
  for (const task of definition.tasks) {
    for (const harness of definition.harnesses) {
      for (const model of definition.models) {
        for (const host of definition.hosts) {
          for (
            let repetition = 0;
            repetition < definition.repetitions;
            repetition += 1
          ) {
            const withoutId = {
              candidate: definition.candidate,
              task,
              harness,
              model,
              host,
              repetition,
            };
            trials.push({ ...withoutId, id: createTrialIdentity(withoutId) });
          }
        }
      }
    }
  }
  const identities = new Set(trials.map((trial) => trial.id));
  if (identities.size !== trials.length)
    throw new Error("matrix produced duplicate trial identities");
  return Object.freeze(trials);
}
