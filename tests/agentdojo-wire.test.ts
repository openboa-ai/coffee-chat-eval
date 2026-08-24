import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createAgentDojoInventory } from "../src/agentdojo.ts";

const bridgePath = fileURLToPath(
  new URL("../integrations/agentdojo/bridge.py", import.meta.url),
);

function runPython(source: string): unknown {
  const result = spawnSync("python3", ["-c", source, bridgePath], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout) as unknown;
}

test("AgentDojo bridge translates native messages and tools to Responses wire items", () => {
  const observed = runPython(String.raw`
import importlib.util
import json
import sys
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("coffee_chat_agentdojo_bridge", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

call = SimpleNamespace(function="lookup_record", args={"record_id": 7}, id="call_lookup_1")
messages = [
    {"role": "system", "content": [{"type": "text", "content": "System policy"}]},
    {"role": "user", "content": [{"type": "text", "content": "Find record 7"}]},
    {
        "role": "assistant",
        "content": [{"type": "text", "content": "I will look it up."}],
        "tool_calls": [call],
    },
    {
        "role": "tool",
        "content": [{"type": "text", "content": "record: seven"}],
        "tool_call": call,
        "tool_call_id": "call_lookup_1",
        "error": None,
    },
    {
        "role": "assistant",
        "content": [{"type": "text", "content": "Found it."}],
        "tool_calls": None,
    },
]

class Schema:
    @classmethod
    def model_json_schema(cls):
        return {
            "type": "object",
            "properties": {"record_id": {"type": "integer"}},
            "required": ["record_id"],
            "additionalProperties": False,
        }

runtime = SimpleNamespace(functions={
    "lookup_record": SimpleNamespace(
        name="lookup_record",
        description="Lookup a synthetic record",
        parameters=Schema,
    )
})

print(json.dumps({
    "input": bridge._messages_to_responses_input(messages),
    "tools": bridge._tool_schema(runtime),
}, sort_keys=True))
`);

  assert.deepEqual(observed, {
    input: [
      { role: "system", content: "System policy" },
      { role: "user", content: "Find record 7" },
      { role: "assistant", content: "I will look it up." },
      {
        type: "function_call",
        call_id: "call_lookup_1",
        name: "lookup_record",
        arguments: '{"record_id":7}',
      },
      {
        type: "function_call_output",
        call_id: "call_lookup_1",
        output: "record: seven",
      },
      { role: "assistant", content: "Found it." },
    ],
    tools: [
      {
        type: "function",
        name: "lookup_record",
        description: "Lookup a synthetic record",
        parameters: {
          type: "object",
          properties: { record_id: { type: "integer" } },
          required: ["record_id"],
          additionalProperties: false,
        },
        strict: false,
      },
    ],
  });
});

test("AgentDojo bridge fails closed on unmatched or missing function call IDs", () => {
  const observed = runPython(String.raw`
import importlib.util
import json
import sys
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location("coffee_chat_agentdojo_bridge", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

cases = {}
for label, messages in {
    "missing": [{
        "role": "assistant",
        "content": None,
        "tool_calls": [SimpleNamespace(function="lookup", args={}, id=None)],
    }],
    "unmatched": [{
        "role": "tool",
        "content": [{"type": "text", "content": "result"}],
        "tool_call": SimpleNamespace(function="lookup", args={}, id="call_other"),
        "tool_call_id": "call_other",
        "error": None,
    }],
}.items():
    try:
        bridge._messages_to_responses_input(messages)
    except bridge.BrokerUnavailable as error:
        cases[label] = str(error)
    else:
        cases[label] = "accepted"

try:
    bridge._response_replay_group({
        "output": [
            {"type": "reasoning", "id": "rs_1", "summary": [], "status": "completed"},
            {"type": "function_call", "call_id": "call_1", "name": "lookup", "arguments": "{}"},
        ]
    })
except bridge.BrokerUnavailable as error:
    cases["reasoning"] = str(error)
else:
    cases["reasoning"] = "accepted"

print(json.dumps(cases, sort_keys=True))
`);

  assert.deepEqual(observed, {
    missing: "AgentDojo function call ID is required for Responses",
    reasoning: "broker reasoning replay item is invalid",
    unmatched: "AgentDojo tool result does not match a prior function call",
  });
});

test("AgentDojo broker query sends only translated messages and declared schemas", () => {
  const observed = runPython(String.raw`
import importlib.util
import json
import sys
import types
from types import SimpleNamespace

agentdojo = types.ModuleType("agentdojo")
functions_runtime = types.ModuleType("agentdojo.functions_runtime")
agentdojo_types = types.ModuleType("agentdojo.types")

class FunctionCall:
    def __init__(self, function, args, id=None):
        self.function = function
        self.args = args
        self.id = id

functions_runtime.FunctionCall = FunctionCall
agentdojo_types.text_content_block_from_string = lambda content: {"type": "text", "content": content}
sys.modules["agentdojo"] = agentdojo
sys.modules["agentdojo.functions_runtime"] = functions_runtime
sys.modules["agentdojo.types"] = agentdojo_types

spec = importlib.util.spec_from_file_location("coffee_chat_agentdojo_bridge", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

class Schema:
    @classmethod
    def model_json_schema(cls):
        return {"type": "object", "properties": {}, "additionalProperties": False}

runtime = SimpleNamespace(functions={
    "lookup": SimpleNamespace(name="lookup", description="Lookup", parameters=Schema)
})
messages = [
    {"role": "system", "content": [{"type": "text", "content": "safe system"}]},
    {"role": "user", "content": [{"type": "text", "content": "safe task"}]},
]
captured = {"payloads": []}
responses = [
    {
        "status": "completed",
        "output": [
            {
                "type": "reasoning",
                "id": "rs_lookup_1",
                "status": "completed",
                "summary": [],
                "encrypted_content": "encrypted-reasoning-1",
            },
            {
                "type": "function_call",
                "call_id": "call_lookup_1",
                "name": "lookup",
                "arguments": "{}",
            },
        ],
    },
    {
        "status": "completed",
        "output": [{
            "type": "message",
            "role": "assistant",
            "content": [{"type": "output_text", "text": "done"}],
        }],
    },
]

class Response:
    def __init__(self, payload):
        self.payload = payload
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def read(self):
        return json.dumps(self.payload).encode("utf-8")

def urlopen(request, timeout):
    captured["payloads"].append(json.loads(request.data))
    captured["authorization"] = request.headers["Authorization"]
    captured["timeout"] = timeout
    return Response(responses[len(captured["payloads"]) - 1])

bridge.urllib.request.urlopen = urlopen
broker = bridge.BrokerLLMElement(
    "http://127.0.0.1:4311/responses",
    "scoped-capability",
    "gpt-5.6-luna",
    45,
)
_, _, returned_env, returned_messages, returned_extra = broker.query(
    "discarded query",
    runtime,
    env=SimpleNamespace(secret="evaluator-only"),
    messages=messages,
    extra_args={
        "scorer": "evaluator-only",
        "injectionGoal": "evaluator-only",
        "groundTruth": "evaluator-only",
    },
)
tool_call = returned_messages[-1]["tool_calls"][0]
tool_message = {
    "role": "tool",
    "content": [{"type": "text", "content": "record: seven"}],
    "tool_call": tool_call,
    "tool_call_id": tool_call.id,
    "error": None,
}
_, _, _, final_messages, _ = broker.query(
    "discarded query",
    runtime,
    env=returned_env,
    messages=[*returned_messages, tool_message],
    extra_args=returned_extra,
)
captured["returned_env_secret"] = returned_env.secret
captured["assistant"] = {
    "role": final_messages[-1]["role"],
    "content": final_messages[-1]["content"],
    "tool_calls": [
        {"function": call.function, "args": call.args, "id": call.id}
        for call in [final_messages[-2]["tool_call"]]
    ],
}
print(json.dumps(captured, sort_keys=True))
`);

  assert.deepEqual(observed, {
    payloads: [
      {
        model: "gpt-5.6-luna",
        input: [
          { role: "system", content: "safe system" },
          { role: "user", content: "safe task" },
        ],
        include: ["reasoning.encrypted_content"],
        tools: [
          {
            type: "function",
            name: "lookup",
            description: "Lookup",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            strict: false,
          },
        ],
        store: false,
      },
      {
        model: "gpt-5.6-luna",
        input: [
          { role: "system", content: "safe system" },
          { role: "user", content: "safe task" },
          {
            type: "reasoning",
            id: "rs_lookup_1",
            status: "completed",
            summary: [],
            encrypted_content: "encrypted-reasoning-1",
          },
          {
            type: "function_call",
            call_id: "call_lookup_1",
            name: "lookup",
            arguments: "{}",
          },
          {
            type: "function_call_output",
            call_id: "call_lookup_1",
            output: "record: seven",
          },
        ],
        include: ["reasoning.encrypted_content"],
        tools: [
          {
            type: "function",
            name: "lookup",
            description: "Lookup",
            parameters: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
            strict: false,
          },
        ],
        store: false,
      },
    ],
    authorization: "Bearer scoped-capability",
    timeout: 60,
    returned_env_secret: "evaluator-only",
    assistant: {
      role: "assistant",
      content: [{ type: "text", content: "done" }],
      tool_calls: [{ function: "lookup", args: {}, id: "call_lookup_1" }],
    },
  });
  assert.doesNotMatch(
    JSON.stringify((observed as { payloads: unknown }).payloads),
    /discarded query|evaluator-only|scorer|injectionGoal|groundTruth/u,
  );
});

test("AgentDojo separates malformed completed candidate output from broker unavailability", () => {
  const observed = runPython(String.raw`
import importlib.util
import json
import sys
import types

agentdojo = types.ModuleType("agentdojo")
functions_runtime = types.ModuleType("agentdojo.functions_runtime")
agentdojo_types = types.ModuleType("agentdojo.types")

class FunctionCall:
    def __init__(self, function, args, id=None):
        self.function = function
        self.args = args
        self.id = id

functions_runtime.FunctionCall = FunctionCall
agentdojo_types.text_content_block_from_string = lambda content: {"type": "text", "content": content}
sys.modules["agentdojo"] = agentdojo
sys.modules["agentdojo.functions_runtime"] = functions_runtime
sys.modules["agentdojo.types"] = agentdojo_types

spec = importlib.util.spec_from_file_location("coffee_chat_agentdojo_bridge", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

payloads = {
    "malformed_arguments": {
        "status": "completed",
        "output": [{
            "type": "function_call",
            "call_id": "call_1",
            "name": "lookup",
            "arguments": "not-json",
        }],
    },
    "duplicate_call_ids": {
        "status": "completed",
        "output": [
            {"type": "function_call", "call_id": "call_1", "name": "lookup", "arguments": "{}"},
            {"type": "function_call", "call_id": "call_1", "name": "lookup", "arguments": "{}"},
        ],
    },
    "provider_error": {
        "status": "failed",
        "error": {"message": "provider failed"},
        "output": [],
    },
    "in_progress": {
        "status": "in_progress",
        "error": None,
        "output": [],
    },
    "missing_status": {
        "error": None,
        "output": [],
    },
}

outcomes = {}
for label, payload in payloads.items():
    try:
        bridge._response_assistant(payload)
    except Exception as error:
        outcomes[label] = type(error).__name__
    else:
        outcomes[label] = "accepted"

print(json.dumps(outcomes, sort_keys=True))
`);

  assert.deepEqual(observed, {
    duplicate_call_ids: "CandidateOutputInvalid",
    in_progress: "BrokerUnavailable",
    malformed_arguments: "CandidateOutputInvalid",
    missing_status: "BrokerUnavailable",
    provider_error: "BrokerUnavailable",
  });
});

test("AgentDojo bridge derives the turn ceiling from each admitted profile", () => {
  const observed = runPython(String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("coffee_chat_agentdojo_bridge", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

print(json.dumps({
    "fixture": bridge._candidate_turn_ceiling("fixture", 3),
    "smoke": bridge._candidate_turn_ceiling("smoke", 3),
    "pilot": bridge._candidate_turn_ceiling("pilot", 24),
    "score": bridge._candidate_turn_ceiling("score", 1081),
}, sort_keys=True))
`);

  assert.deepEqual(observed, {
    fixture: 3,
    pilot: 360,
    score: 16215,
    smoke: 45,
  });
});

test("AgentDojo score inventory matches the exact pinned task-ID authority", () => {
  const expected = createAgentDojoInventory("score").map((episode) => ({
    suite: episode.suite,
    kind: episode.kind,
    userTaskId: episode.userTaskId,
    injectionTaskId: episode.injectionTaskId,
  }));
  const slackInjectionTasks = expected
    .filter(
      (episode) => episode.suite === "slack" && episode.kind === "injection-control",
    )
    .map((episode) => episode.injectionTaskId);

  assert.deepEqual(slackInjectionTasks, [
    "injection_task_1",
    "injection_task_2",
    "injection_task_3",
    "injection_task_4",
    "injection_task_5",
  ]);

  const observed = runPython(String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("coffee_chat_agentdojo_bridge", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

checks = {}
for label, users, injections in (
    (
        "upstream_order",
        tuple(reversed(bridge.SCORE_USER_TASKS["workspace"])),
        tuple(reversed(bridge.SCORE_INJECTION_TASKS["workspace"])),
    ),
    (
        "missing_task",
        bridge.SCORE_USER_TASKS["workspace"][:-1],
        bridge.SCORE_INJECTION_TASKS["workspace"],
    ),
):
    try:
        bridge._verify_score_task_ids("workspace", users, injections)
    except ValueError:
        checks[label] = "rejected"
    else:
        checks[label] = "accepted"

print(json.dumps({
    "episodes": bridge._episode_ids("score", None, None),
    "checks": checks,
}, sort_keys=True))
`) as {
    readonly episodes: readonly Record<string, unknown>[];
    readonly checks: Readonly<Record<string, string>>;
  };

  assert.equal(observed.episodes.length, 1081);
  assert.deepEqual(observed.episodes, expected);
  assert.deepEqual(observed.checks, {
    missing_task: "rejected",
    upstream_order: "accepted",
  });
});
