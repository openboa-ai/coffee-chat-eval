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

test("BEAM BrokerJudge rejects incomplete, error, and outputless HTTP 200 envelopes", () => {
  const result = runPython(String.raw`
import importlib.util
import json
import sys

spec = importlib.util.spec_from_file_location("beam_bridge", sys.argv[1])
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

payloads = [
    {"status": "incomplete", "error": None, "output": []},
    {"status": "failed", "error": {"message": "provider failed"}, "output": []},
    {"status": "completed", "error": None, "output": []},
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
for _index in range(3):
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
        outcomes.append(str(error))
    else:
        outcomes.append("MEASURED")
print(json.dumps(outcomes))
`);

  assert.deepEqual(result, [
    "BEAM Judge completion did not finish",
    "BEAM Judge completion reported an error",
    "BEAM Judge completion has no usable output",
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

test("BEAM bridge main writes the exact unavailable Judge outcome", () => {
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
    output = root / "beam-native.json"
    def unavailable(*_args, **_kwargs):
        raise bridge.JudgeUnavailableError("BEAM Judge broker transport is unavailable")
    bridge.run = unavailable
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
    print(json.dumps(json.loads(output.read_text(encoding="utf-8")), sort_keys=True))
`);

  assert.deepEqual(result, {
    schema: "coffee-chat-eval/beam-bridge-outcome-v1",
    executionStatus: "unavailable",
    failureOwner: "judge",
    reason: "BEAM Judge broker transport is unavailable",
  });
});
