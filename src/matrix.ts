import { createTrialIdentity } from "./identity.ts";
import { canonicalEvaluatorRef, snapshotAndFreeze } from "./validation.ts";
import type { MatrixDefinition, TrialSpec } from "./types.ts";

export function expandMatrix(definition: MatrixDefinition): readonly TrialSpec[] {
  const matrix = snapshotAndFreeze(definition);
  const evaluator = canonicalEvaluatorRef(matrix.evaluator);
  if (!evaluator) {
    throw new TypeError("trusted evaluator provenance is invalid");
  }
  if (!Number.isInteger(matrix.repetitions) || matrix.repetitions < 1) {
    throw new Error("repetitions must be a positive integer");
  }
  for (const [axis, entries] of [
    ["tasks", matrix.tasks],
    ["harnesses", matrix.harnesses],
    ["models", matrix.models],
    ["hosts", matrix.hosts],
  ] as const) {
    if (entries.length === 0) {
      throw new Error(`${axis} must contain at least one entry`);
    }
  }
  const trials: TrialSpec[] = [];
  for (const task of matrix.tasks) {
    for (const harness of matrix.harnesses) {
      for (const model of matrix.models) {
        for (const host of matrix.hosts) {
          for (let repetition = 0; repetition < matrix.repetitions; repetition += 1) {
            const withoutId = snapshotAndFreeze({
              evaluator,
              candidate: matrix.candidate,
              task,
              harness,
              model,
              host,
              repetition,
            });
            trials.push(
              snapshotAndFreeze({
                ...withoutId,
                id: createTrialIdentity(withoutId),
              }),
            );
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
