import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

const bridgePath = new URL("../integrations/beam/bridge.py", import.meta.url).pathname;

function runPython(script: string): unknown {
  return JSON.parse(
    execFileSync("python3", ["-c", script, bridgePath], {
      encoding: "utf8",
    }),
  ) as unknown;
}

test("BEAM BrokerJudge disables provider storage and accepts only completed score JSON", () => {
  const result = runPython(String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("beam_bridge", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

requests = []

class Response:
    def __enter__(self):
        return self
    def __exit__(self, *_args):
        return False
    def read(self):
        return json.dumps({
            "status": "completed",
            "error": None,
            "output_text": json.dumps({"score": 0.5}),
        }).encode("utf-8")

def urlopen(request, timeout):
    requests.append(json.loads(request.data.decode("utf-8")))
    return Response()

bridge.urllib.request.urlopen = urlopen
judge = bridge.BrokerJudge({
    "scope": "judge",
    "endpoint": "http://127.0.0.1/responses",
    "capabilityToken": "scoped",
    "model": "gpt-5.6-luna",
    "maxRequests": 1,
})
verdict = judge.invoke("rubric prompt")
print(json.dumps({"request": requests[0], "content": verdict.content}))
`);

  assert.deepEqual(result, {
    request: {
      model: "gpt-5.6-luna",
      input: "rubric prompt",
      store: false,
    },
    content: '{"score": 0.5}',
  });
});

test("BEAM BrokerJudge separates nonterminal HTTP 200 envelopes from invalid terminal output", () => {
  const result = runPython(String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("beam_bridge", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

payloads = [
    {"status": "queued", "error": None, "output": []},
    {"status": "in_progress", "error": None, "output": []},
    {"status": "incomplete", "error": None, "output": []},
    {"status": "failed", "error": {"message": "provider failed"}, "output": []},
    {"status": "completed", "error": {"message": "provider failed"}, "output": []},
    {"status": "completed", "error": None, "output": []},
    {"status": "completed", "error": None, "output_text": "not-json"},
    {"status": "completed", "error": None, "output_text": json.dumps({"score": 0.25})},
]

class Response:
    def __init__(self, payload):
        self.payload = payload
    def __enter__(self):
        return self
    def __exit__(self, *_args):
        return False
    def read(self):
        return json.dumps(self.payload).encode("utf-8")

def urlopen(_request, timeout):
    return Response(payloads.pop(0))

bridge.urllib.request.urlopen = urlopen
outcomes = []
for _index in range(len(payloads)):
    judge = bridge.BrokerJudge({
        "scope": "judge",
        "endpoint": "http://127.0.0.1/responses",
        "capabilityToken": "scoped",
        "model": "gpt-5.6-luna",
        "maxRequests": 1,
    })
    try:
        judge.invoke("rubric prompt")
    except Exception as error:
        outcomes.append({"type": type(error).__name__, "message": str(error)})
    else:
        outcomes.append("MEASURED")
print(json.dumps(outcomes))
`);

  assert.deepEqual(result, [
    {
      type: "JudgeUnavailableError",
      message: "BEAM Judge broker transport is unavailable",
    },
    {
      type: "JudgeUnavailableError",
      message: "BEAM Judge broker transport is unavailable",
    },
    {
      type: "JudgeUnavailableError",
      message: "BEAM Judge broker transport is unavailable",
    },
    { type: "RuntimeError", message: "BEAM Judge completion reported an error" },
    { type: "RuntimeError", message: "BEAM Judge completion reported an error" },
    { type: "ValueError", message: "BEAM Judge completion has no usable output" },
    { type: "ValueError", message: "BEAM Judge returned malformed JSON" },
    {
      type: "ValueError",
      message: "BEAM Judge score must be exactly 0, 0.5, or 1",
    },
  ]);
});

test("BEAM BrokerJudge separates transport outages from malformed Judge JSON", () => {
  const result = runPython(String.raw`
import importlib.util
import io
import json
import sys
import urllib.error

spec = importlib.util.spec_from_file_location("beam_bridge", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

failures = [
    TimeoutError("timed out"),
    urllib.error.URLError("connection refused"),
    urllib.error.HTTPError("http://127.0.0.1", 503, "unavailable", {}, io.BytesIO()),
]
outcomes = []
for failure in failures:
    def urlopen(_request, timeout, failure=failure):
        raise failure
    bridge.urllib.request.urlopen = urlopen
    judge = bridge.BrokerJudge({
        "scope": "judge",
        "endpoint": "http://127.0.0.1/responses",
        "capabilityToken": "scoped",
        "model": "gpt-5.6-luna",
        "maxRequests": 1,
    })
    try:
        judge.invoke("rubric prompt")
    except Exception as error:
        outcomes.append({"type": type(error).__name__, "message": str(error)})

class Response:
    def __enter__(self):
        return self
    def __exit__(self, *_args):
        return False
    def read(self):
        return json.dumps({
            "status": "completed",
            "error": None,
            "output_text": "not-json",
        }).encode("utf-8")

bridge.urllib.request.urlopen = lambda _request, timeout: Response()
judge = bridge.BrokerJudge({
    "scope": "judge",
    "endpoint": "http://127.0.0.1/responses",
    "capabilityToken": "scoped",
    "model": "gpt-5.6-luna",
    "maxRequests": 1,
})
try:
    judge.invoke("rubric prompt")
except Exception as error:
    outcomes.append({"type": type(error).__name__, "message": str(error)})

print(json.dumps(outcomes))
`);

  assert.deepEqual(result, [
    {
      type: "JudgeUnavailableError",
      message: "BEAM Judge broker transport is unavailable",
    },
    {
      type: "JudgeUnavailableError",
      message: "BEAM Judge broker transport is unavailable",
    },
    {
      type: "JudgeUnavailableError",
      message: "BEAM Judge broker transport is unavailable",
    },
    { type: "ValueError", message: "BEAM Judge returned malformed JSON" },
  ]);
});

test("BEAM bridge main maps each nonterminal Judge status to the exact unavailable outcome", () => {
  const result = runPython(String.raw`
import importlib.util
import json
import sys
import tempfile
from pathlib import Path

spec = importlib.util.spec_from_file_location("beam_bridge", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    current = {"status": None}

    class Response:
        def __enter__(self):
            return self
        def __exit__(self, *_args):
            return False
        def read(self):
            return json.dumps({
                "status": current["status"],
                "error": None,
                "output": [],
            }).encode("utf-8")

    bridge.urllib.request.urlopen = lambda _request, timeout: Response()

    def invoke_nonterminal(*_args, **_kwargs):
        judge = bridge.BrokerJudge({
            "scope": "judge",
            "endpoint": "http://127.0.0.1/responses",
            "capabilityToken": "scoped",
            "model": "gpt-5.6-luna",
            "maxRequests": 1,
        })
        judge.invoke("rubric prompt")

    bridge.run = invoke_nonterminal
    outcomes = {}
    for status in ("queued", "in_progress", "incomplete"):
        current["status"] = status
        output = root / f"beam-native-{status}.json"
        sys.argv = [
            "bridge.py",
            "--source-root", str(root),
            "--data-root", str(root),
            "--query-path", str(root / "queries.json"),
            "--response-path", str(root / "responses.json"),
            "--output", str(output),
            "--tier", "100K",
            "--profile", "smoke",
            "--judge-runtime", str(root / "judge.json"),
        ]
        bridge.main()
        outcomes[status] = json.loads(output.read_text(encoding="utf-8"))
    print(json.dumps(outcomes, sort_keys=True))
`);

  const unavailable = {
    schema: "coffee-chat-eval/beam-bridge-outcome-v1",
    executionStatus: "unavailable",
    failureOwner: "judge",
    reason: "BEAM Judge broker transport is unavailable",
  };
  assert.deepEqual(result, {
    incomplete: unavailable,
    in_progress: unavailable,
    queued: unavailable,
  });
});
