import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BEAM_RUNTIME_LOCK,
  evalOwnedRuntimeLockForTrack,
  IFEVAL_RUNTIME_LOCK,
  runtimeEnvironment,
} from "../src/python-runtime.ts";

function exactPins(path: string): ReadonlyMap<string, string> {
  const lines = readFileSync(path, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const pins = new Map<string, string>();
  for (const line of lines) {
    const match = /^([a-z0-9][a-z0-9._-]*)==([^\s]+)$/u.exec(line);
    assert.ok(match, `runtime dependency must be exactly pinned: ${line}`);
    const name = match[1]!;
    assert.equal(pins.has(name), false, `runtime dependency is duplicated: ${name}`);
    pins.set(name, match[2]!);
  }
  return pins;
}

test("IFEval and BEAM runtime locks pin their complete imported dependency closures", () => {
  assert.deepEqual([...exactPins(IFEVAL_RUNTIME_LOCK).keys()].sort(), [
    "absl-py",
    "click",
    "defusedxml",
    "immutabledict",
    "joblib",
    "langdetect",
    "nltk",
    "regex",
    "six",
    "tqdm",
  ]);
  assert.deepEqual([...exactPins(BEAM_RUNTIME_LOCK).keys()].sort(), [
    "absl-py",
    "click",
    "defusedxml",
    "joblib",
    "json-repair",
    "nltk",
    "numpy",
    "pyarrow",
    "regex",
    "rouge-score",
    "scipy",
    "six",
    "tqdm",
  ]);
});

test("only admitted Eval-owned Python tracks resolve repository runtime locks", () => {
  assert.equal(evalOwnedRuntimeLockForTrack("ifeval"), IFEVAL_RUNTIME_LOCK);
  assert.equal(evalOwnedRuntimeLockForTrack("beam-record-core"), BEAM_RUNTIME_LOCK);
  assert.equal(evalOwnedRuntimeLockForTrack("coffee-chat-taste"), undefined);
  assert.equal(evalOwnedRuntimeLockForTrack("agentdojo-security"), undefined);
});

test("runtime locks bind the exact NLTK data source, rights evidence, and resource bytes", () => {
  const expected = [
    "# nltk-data-repository=https://github.com/nltk/nltk_data",
    "# nltk-data-commit=550b6625bcef1f2abff2ff770a5a0d272c9c6b2a",
    "# nltk-data-repository-license=Apache-2.0",
    "# nltk-data-repository-license-digest=sha256:8d030ab5afc58f0b6a1f4207c12fd9553de6da2294efede65a0c58f9a6495fcc",
    "# nltk-data-package-license-status=unclarified",
    "# nltk-data-package-index-license-attribute=absent",
    "# nltk-data-resource=tokenizers/punkt_tab.zip",
    "# nltk-data-resource-bytes=4319076",
    "# nltk-data-resource-digest=sha256:e57f64187974277726a3417ca6f181ec5403676c717672eef6a748a7b20e0106",
  ];
  for (const path of [IFEVAL_RUNTIME_LOCK, BEAM_RUNTIME_LOCK]) {
    const lines = readFileSync(path, "utf8").split("\n");
    for (const contract of expected) assert.ok(lines.includes(contract));
  }
  assert.match(
    readFileSync(IFEVAL_RUNTIME_LOCK, "utf8"),
    /^# nltk-data-rights-policy=rights_hold$/mu,
  );
  assert.match(
    readFileSync(BEAM_RUNTIME_LOCK, "utf8"),
    /^# nltk-data-rights-policy=not_used_by_admitted_scorers$/mu,
  );
});

test("Python bridge runtime environment binds NLTK data below the per-track runtime", () => {
  const environment = runtimeEnvironment("/cache/ifeval/source");
  assert.equal(environment.UV_PROJECT_ENVIRONMENT, "/cache/ifeval/runtime");
  assert.equal(environment.NLTK_DATA, "/cache/ifeval/runtime/nltk_data");
  assert.equal(environment.PYTHONDONTWRITEBYTECODE, "1");
  assert.equal(environment.PYTHONNOUSERSITE, "1");
});

test("Python bridge runtime environment excludes provider keys and ambient secrets", () => {
  const providerKeyEnv = "COFFEE_CHAT_PROVIDER_KEY";
  const inherited = {
    PATH: process.env.PATH,
    LANG: process.env.LANG,
    TMPDIR: process.env.TMPDIR,
    SSL_CERT_FILE: process.env.SSL_CERT_FILE,
    HTTPS_PROXY: process.env.HTTPS_PROXY,
    PYTHONPATH: process.env.PYTHONPATH,
    [providerKeyEnv]: process.env[providerKeyEnv],
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    UNRELATED_SECRET: process.env.UNRELATED_SECRET,
  };

  try {
    process.env.PATH = "/runtime/test/bin";
    process.env.LANG = "C.UTF-8";
    process.env.TMPDIR = "/runtime/tmp";
    process.env.SSL_CERT_FILE = "/runtime/certs/ca.pem";
    process.env.HTTPS_PROXY = "http://proxy-user:proxy-secret@example.invalid";
    process.env.PYTHONPATH = "/ambient/python/modules";
    process.env[providerKeyEnv] = "dynamic-provider-secret";
    process.env.OPENAI_API_KEY = "openai-provider-secret";
    process.env.UNRELATED_SECRET = "ambient-secret";

    const environment = runtimeEnvironment("/cache/agentdojo/source");

    assert.equal(environment.PATH, "/runtime/test/bin");
    assert.equal(environment.LANG, "C.UTF-8");
    assert.equal(environment.TMPDIR, "/runtime/tmp");
    assert.equal(environment.SSL_CERT_FILE, "/runtime/certs/ca.pem");
    assert.equal(environment.HTTPS_PROXY, undefined);
    assert.equal(environment.PYTHONPATH, undefined);
    assert.equal(environment[providerKeyEnv], undefined);
    assert.equal(environment.OPENAI_API_KEY, undefined);
    assert.equal(environment.UNRELATED_SECRET, undefined);
  } finally {
    for (const [name, value] of Object.entries(inherited)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("BEAM bypasses only unused import-time NLTK downloads without requiring Punkt data", () => {
  const script = String.raw`
import importlib.util
import os
import sys
import tempfile
import types

bridge_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("beam_bridge", bridge_path)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

network_calls = []
resource_lookups = []
tokenizer_calls = []
nltk = types.ModuleType("nltk")
nltk.data = types.SimpleNamespace(
    find=lambda path: resource_lookups.append(path),
    path=["/ambient/nltk-data"],
)
nltk.download = lambda *args, **kwargs: network_calls.append((args, kwargs))
nltk.word_tokenize = lambda *args, **kwargs: tokenizer_calls.append((args, kwargs))
nltk.sent_tokenize = lambda *args, **kwargs: tokenizer_calls.append((args, kwargs))
sys.modules["nltk"] = nltk

with tempfile.TemporaryDirectory() as root:
    os.environ["NLTK_DATA"] = root
    seal = bridge._install_offline_nltk_guard()
    assert nltk.data.path == [root]
    assert nltk.download("punkt") is True
    assert nltk.download("punkt_tab", quiet=True) is True
    assert network_calls == []
    assert resource_lookups == []
    try:
        nltk.download("unadmitted")
    except RuntimeError:
        pass
    else:
        raise AssertionError("unadmitted NLTK downloads must fail closed")
    seal()
    for operation in (
        lambda: nltk.download("punkt"),
        lambda: nltk.word_tokenize("one two", preserve_line=True),
        lambda: nltk.sent_tokenize("One. Two."),
    ):
        try:
            operation()
        except RuntimeError:
            pass
        else:
            raise AssertionError("BEAM NLTK use must be sealed after import")
    assert network_calls == []
    assert tokenizer_calls == []
`;
  execFileSync("python3", [
    "-c",
    script,
    new URL("../integrations/beam/bridge.py", import.meta.url).pathname,
  ]);
});

test("BEAM rejects Punkt data bytes even though admitted scorers do not use them", () => {
  const script = String.raw`
import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path

bridge_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("beam_bridge", bridge_path)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

nltk = types.ModuleType("nltk")
nltk.data = types.SimpleNamespace(path=[])
sys.modules["nltk"] = nltk

with tempfile.TemporaryDirectory() as root:
    archive = Path(root) / "tokenizers" / "punkt_tab.zip"
    archive.parent.mkdir(parents=True)
    archive.write_bytes(b"unadmitted")
    os.environ["NLTK_DATA"] = root
    try:
        bridge._install_offline_nltk_guard()
    except RuntimeError as exc:
        assert "not admitted" in str(exc)
    else:
        raise AssertionError("Punkt data bytes must be rejected")
`;
  execFileSync("python3", [
    "-c",
    script,
    new URL("../integrations/beam/bridge.py", import.meta.url).pathname,
  ]);
});

test("IFEval fails closed when its preloaded NLTK resources are unavailable", () => {
  const script = String.raw`
import importlib.util
import os
import sys
import tempfile
import types

bridge_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("ifeval_bridge", bridge_path)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

with tempfile.TemporaryDirectory() as root:
    os.environ["NLTK_DATA"] = root
    try:
        bridge._require_offline_nltk_data()
    except RuntimeError as exc:
        assert "punkt_tab" in str(exc)
    else:
        raise AssertionError("missing NLTK data must fail before native evaluation")
`;
  execFileSync("python3", [
    "-c",
    script,
    new URL("../integrations/ifeval/bridge.py", import.meta.url).pathname,
  ]);
});

test("IFEval runtime-asset preflight verifies the extracted tree and confines NLTK lookup", () => {
  const script = String.raw`
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import sys
import tempfile
import types
import zipfile
from pathlib import Path

bridge_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("ifeval_bridge", bridge_path)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

with tempfile.TemporaryDirectory() as root_value:
    root = Path(root_value)
    archive = root / "tokenizers" / "punkt_tab.zip"
    archive.parent.mkdir(parents=True)
    with zipfile.ZipFile(archive, "w") as package:
        package.writestr("punkt_tab/", b"")
        package.writestr("punkt_tab/english/", b"")
        package.writestr("punkt_tab/english/collocations.tab", b"one\ttwo\n")
        package.writestr("punkt_tab/english/sent_starters.txt", b"One\n")
        package.writestr("punkt_tab/english/abbrev_types.txt", b"Dr\n")
        package.writestr("punkt_tab/english/ortho_context.tab", b"word\t1\n")
    with zipfile.ZipFile(archive) as package:
        package.extractall(archive.parent)

    archive_bytes = archive.read_bytes()
    bridge.NLTK_DATA_BYTES = len(archive_bytes)
    bridge.NLTK_DATA_DIGEST = hashlib.sha256(archive_bytes).hexdigest()
    os.environ["NLTK_DATA"] = str(root)

    lookups = []
    nltk = types.ModuleType("nltk")
    nltk.__version__ = "3.10.1"
    nltk.data = types.SimpleNamespace(path=["/ambient/nltk-data"])

    def find(resource):
        lookups.append(resource)
        assert nltk.data.path == [str(root.resolve())]
        return root / resource

    nltk.data.find = find
    nltk.word_tokenize = lambda text: ["One", "sentence", ".", "Two", "sentences", "."]
    sys.modules["nltk"] = nltk

    previous_argv = sys.argv
    sys.argv = [bridge_path, "--preflight-only"]
    output = io.StringIO()
    try:
        with contextlib.redirect_stdout(output):
            bridge.main()
    finally:
        sys.argv = previous_argv

    receipt = json.loads(output.getvalue())
    assert receipt["schema"] == "coffee-chat-eval/ifeval-runtime-asset-preflight-v1"
    assert receipt["status"] == "verified"
    assert receipt["assetBytes"] == len(archive_bytes)
    assert receipt["assetDigest"] == "sha256:" + hashlib.sha256(archive_bytes).hexdigest()
    assert receipt["extractedFileCount"] == 4
    assert receipt["nltkVersion"] == "3.10.1"
    assert receipt["integrityOnly"] is True
    assert receipt["rightsCleared"] is False
    assert lookups == ["tokenizers/punkt_tab"]
`;
  execFileSync("python3", [
    "-c",
    script,
    new URL("../integrations/ifeval/bridge.py", import.meta.url).pathname,
  ]);
});

test("IFEval runtime-asset preflight rejects archive-only and extracted drift before NLTK lookup", () => {
  const script = String.raw`
import hashlib
import importlib.util
import os
import sys
import tempfile
import types
import zipfile
from pathlib import Path

bridge_path = sys.argv[1]
spec = importlib.util.spec_from_file_location("ifeval_bridge", bridge_path)
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)

with tempfile.TemporaryDirectory() as root_value:
    root = Path(root_value)
    archive = root / "tokenizers" / "punkt_tab.zip"
    archive.parent.mkdir(parents=True)
    with zipfile.ZipFile(archive, "w") as package:
        package.writestr("punkt_tab/", b"")
        package.writestr("punkt_tab/english/", b"")
        package.writestr("punkt_tab/english/collocations.tab", b"one\ttwo\n")

    archive_bytes = archive.read_bytes()
    bridge.NLTK_DATA_BYTES = len(archive_bytes)
    bridge.NLTK_DATA_DIGEST = hashlib.sha256(archive_bytes).hexdigest()
    os.environ["NLTK_DATA"] = str(root)

    lookups = []
    nltk = types.ModuleType("nltk")
    nltk.__version__ = "3.10.1"
    nltk.data = types.SimpleNamespace(
        path=["/ambient/nltk-data"],
        find=lambda resource: lookups.append(resource),
    )
    nltk.word_tokenize = lambda text: []
    sys.modules["nltk"] = nltk

    try:
        bridge._preflight_offline_nltk_data()
    except RuntimeError as exc:
        assert "missing extracted NLTK data" in str(exc)
    else:
        raise AssertionError("archive-only runtime data must fail preflight")
    assert lookups == []

    with zipfile.ZipFile(archive) as package:
        package.extractall(archive.parent)
    (root / "tokenizers" / "punkt_tab" / "english" / "collocations.tab").write_bytes(
        b"drifted\n"
    )
    try:
        bridge._preflight_offline_nltk_data()
    except RuntimeError as exc:
        assert "extracted data drifted" in str(exc)
    else:
        raise AssertionError("drifted extracted bytes must fail preflight")
    assert lookups == []
`;
  execFileSync("python3", [
    "-c",
    script,
    new URL("../integrations/ifeval/bridge.py", import.meta.url).pathname,
  ]);
});
