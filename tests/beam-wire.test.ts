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
