import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const resourceModules = [
  join(repositoryRoot, "evals/protocol-canary/tests/resources.py"),
  join(repositoryRoot, "evals/ifeval-smoke/tests/resources.py"),
];
const taskRoots = [
  join(repositoryRoot, "evals/protocol-canary/tests"),
  join(repositoryRoot, "evals/ifeval-smoke/tests"),
];

const probe = String.raw`
import importlib.util
import json
import os
from pathlib import Path
import sys

module_path = Path(sys.argv[1])
root = Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("verifier_resources", module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

valid = root / "valid.json"
valid.write_text(json.dumps({"status": "ok"}), encoding="utf-8")
assert module.read_bounded_json(valid, "valid") == {"status": "ok"}

oversized = root / "oversized.json"
oversized.write_bytes(b" " * (module.MAX_ARTIFACT_BYTES + 1))
try:
    module.read_bounded_json(oversized, "oversized")
    raise AssertionError("oversized artifact accepted")
except ValueError:
    pass

linked = root / "linked.json"
linked.symlink_to(valid)
try:
    module.read_bounded_json(linked, "linked")
    raise AssertionError("symlinked artifact accepted")
except OSError:
    pass

fifo = root / "fifo.json"
os.mkfifo(fifo)
try:
    module.read_bounded_json(fifo, "fifo")
    raise AssertionError("FIFO artifact accepted")
except ValueError:
    pass

deep = root / "deep.json"
value = "leaf"
for _ in range(module.MAX_JSON_DEPTH + 1):
    value = [value]
deep.write_text(json.dumps(value), encoding="utf-8")
try:
    module.read_bounded_json(deep, "deep")
    raise AssertionError("over-depth artifact accepted")
except ValueError:
    pass

mutating = root / "mutating.json"
mutating.write_text(json.dumps({"status": "ok"}), encoding="utf-8")
original_read = module.os.read
changed = False
def mutating_read(descriptor, count):
    global changed
    data = original_read(descriptor, count)
    if not changed:
        changed = True
        with mutating.open("ab") as stream:
            stream.write(b" ")
    return data
module.os.read = mutating_read
try:
    module.read_bounded_json(mutating, "mutating")
    raise AssertionError("mutated artifact accepted")
except ValueError:
    pass
`;

test("both Harbor verifiers use the same bounded descriptor reader", () => {
  assert.equal(
    readFileSync(resourceModules[0], "utf8"),
    readFileSync(resourceModules[1], "utf8"),
  );
  for (const [index, modulePath] of resourceModules.entries()) {
    assert.match(
      readFileSync(join(taskRoots[index], "verify.py"), "utf8"),
      /from resources import read_bounded_json/u,
    );
    assert.match(
      readFileSync(join(taskRoots[index], "Dockerfile"), "utf8"),
      /COPY resources\.py \/tests\/resources\.py/u,
    );
    const root = mkdtempSync(join(tmpdir(), "eval-verifier-resources-"));
    try {
      const result = spawnSync("python3", ["-c", probe, modulePath, root], {
        encoding: "utf8",
      });
      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
