import assert from "node:assert/strict";
import test from "node:test";

import { createAgentDojoBridgeCommand } from "../src/agentdojo.ts";
import { createBeamBridgeCommand } from "../src/beam.ts";
import { createIfevalBridgeCommand } from "../src/ifeval.ts";

test("native bridge commands use absolute cache/evidence paths and pinned exclusions", () => {
  const ifeval = createIfevalBridgeCommand({
    cacheRoot: "/cache/ifeval",
    inputPath: "/cache/ifeval/instruction_following_eval/data/input_data.jsonl",
    responsePath: "/evidence/ifeval/responses.jsonl",
    outputPath: "/evidence/ifeval/native.json",
  });
  assert.equal(ifeval.command, "uv");
  assert.match(ifeval.args.join(" "), /run --offline --no-project/u);
  assert.match(ifeval.args.join(" "), /--with-requirements/u);
  assert.throws(
    () =>
      createIfevalBridgeCommand({
        cacheRoot: "/cache/ifeval",
        inputPath: "/cache/ifeval/input_response_data_gpt4_20231107_145030.jsonl",
        responsePath: "/evidence/responses.jsonl",
        outputPath: "/evidence/native.json",
      }),
    /historical IFEval responses are excluded/u,
  );

  const beam = createBeamBridgeCommand({
    cacheRoot: "/cache/beam",
    queryPath: "/evidence/beam/queries.json",
    responsePath: "/evidence/beam/responses.json",
    outputPath: "/evidence/beam/native.json",
  });
  assert.equal(beam.command, "uv");
  assert.match(beam.args.join(" "), /run --offline --no-project/u);
  assert.match(beam.args.join(" "), /--tier 100K/u);

  const agentdojo = createAgentDojoBridgeCommand({
    cacheRoot: "/cache/agentdojo",
    evidenceRoot: "/evidence/agentdojo",
    candidateConfigPath: "/evidence/agentdojo/candidate.json",
  });
  assert.equal(agentdojo.command, "uv");
  assert.match(
    agentdojo.args.join(" "),
    /run --offline --project \/cache\/agentdojo\/source/u,
  );
  assert.match(agentdojo.args.join(" "), /important_instructions_no_model_name/u);
  assert.match(agentdojo.args.join(" "), /--defense None/u);
  assert.match(
    agentdojo.args.join(" "),
    /--candidate-runtime \/evidence\/agentdojo\/candidate\.json/u,
  );
});
