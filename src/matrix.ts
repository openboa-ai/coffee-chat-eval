import { createTrialIdentity } from "./identity.ts";
import type { MatrixDefinition, TrialSpec } from "./types.ts";

export function expandMatrix(definition: MatrixDefinition): readonly TrialSpec[] {
  if (!Number.isInteger(definition.repetitions) || definition.repetitions < 1) {
    throw new Error("repetitions must be a positive integer");
  }
  for (const [axis, entries] of [
    ["tasks", definition.tasks],
    ["harnesses", definition.harnesses],
    ["models", definition.models],
    ["hosts", definition.hosts],
  ] as const) {
    if (entries.length === 0) {
      throw new Error(`${axis} must contain at least one entry`);
    }
  }
  const evaluator = Object.freeze({
    repository: definition.evaluator.repository,
    commit: definition.evaluator.commit,
    calver: definition.evaluator.calver,
    configurationDigest: definition.evaluator.configurationDigest,
  });
  const candidate = Object.freeze({
    repository: definition.candidate.repository,
    commit: definition.candidate.commit,
    calver: definition.candidate.calver,
    adapter: definition.candidate.adapter,
  });
  const tasks = definition.tasks.map((task) =>
    Object.freeze({ id: task.id, digest: task.digest }),
  );
  const harnesses = definition.harnesses.map((harness) =>
    Object.freeze({ id: harness.id, digest: harness.digest }),
  );
  const models = definition.models.map((model) =>
    Object.freeze({ id: model.id, digest: model.digest }),
  );
  const hosts = definition.hosts.map((host) =>
    Object.freeze({
      id: host.id,
      isolationClass: host.isolationClass,
      configurationDigest: host.configurationDigest,
      isolationReference: host.isolationReference,
    }),
  );
  const trials: TrialSpec[] = [];
  for (const task of tasks) {
    for (const harness of harnesses) {
      for (const model of models) {
        for (const host of hosts) {
          for (
            let repetition = 0;
            repetition < definition.repetitions;
            repetition += 1
          ) {
            const withoutId = {
              evaluator,
              candidate,
              task,
              harness,
              model,
              host,
              repetition,
            };
            trials.push(
              Object.freeze({ ...withoutId, id: createTrialIdentity(withoutId) }),
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
