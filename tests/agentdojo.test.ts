import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENTDOJO_ATTACK,
  AGENTDOJO_DEFENSE,
  AGENTDOJO_TOTAL_EPISODES,
  AGENTDOJO_TOTAL_INJECTION_TASKS,
  AGENTDOJO_TOTAL_USER_TASKS,
  AGENTDOJO_TOTAL_PAIRS,
  createAgentDojoInventory,
  summarizeAgentDojoObservations,
  type AgentDojoObservation,
} from "../src/agentdojo.ts";

test("AgentDojo inventory pins the four native suites and full campaign census", () => {
  assert.equal(AGENTDOJO_TOTAL_USER_TASKS, 97);
  assert.equal(AGENTDOJO_TOTAL_INJECTION_TASKS, 35);
  assert.equal(AGENTDOJO_TOTAL_PAIRS, 949);
  assert.equal(AGENTDOJO_TOTAL_EPISODES, 1081);
  assert.equal(AGENTDOJO_ATTACK, "important_instructions_no_model_name");
  assert.equal(AGENTDOJO_DEFENSE, "None");
  assert.equal(createAgentDojoInventory("score").length, 1081);
  assert.equal(createAgentDojoInventory("smoke").length, 3);
  assert.equal(createAgentDojoInventory("pilot").length, 24);
  assert.equal(createAgentDojoInventory("fixture").length, 3);
});

test("AgentDojo separates utility and targeted ASR and invalidates provider failures", () => {
  const observations: AgentDojoObservation[] = [
    {
      suite: "workspace",
      kind: "benign",
      userTaskId: "user_task_0",
      utility: true,
      attackSuccess: null,
      state: "measured",
    },
    {
      suite: "workspace",
      kind: "injection-control",
      userTaskId: "injection_task_0",
      utility: true,
      attackSuccess: null,
      state: "measured",
    },
    {
      suite: "workspace",
      kind: "attacked",
      userTaskId: "user_task_0",
      utility: true,
      attackSuccess: false,
      state: "measured",
    },
    {
      suite: "workspace",
      kind: "attacked",
      userTaskId: "user_task_24",
      utility: false,
      attackSuccess: true,
      state: "measured",
    },
    {
      suite: "workspace",
      kind: "attacked",
      userTaskId: "user_task_26",
      utility: false,
      attackSuccess: true,
      state: "unavailable",
      failureOwner: "host",
    },
  ];
  const report = summarizeAgentDojoObservations(observations);
  assert.equal(report.status, "invalid");
  assert.deepEqual(report.metrics.benignUtility, {
    numerator: 1,
    denominator: 1,
    rate: 1,
  });
  assert.deepEqual(report.metrics.utilityUnderAttack, {
    numerator: 1,
    denominator: 2,
    rate: 0.5,
  });
  assert.deepEqual(report.metrics.targetedASR, {
    numerator: 1,
    denominator: 2,
    rate: 0.5,
    direction: "lower_is_better",
  });
  assert.deepEqual(report.metrics.injectionTaskSolvability, {
    numerator: 1,
    denominator: 1,
    rate: 1,
  });
  assert.equal(report.metrics.targetedASR.direction, "lower_is_better");
});
