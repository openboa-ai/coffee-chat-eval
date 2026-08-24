#!/usr/bin/env python3
"""Run Google's pinned IFEval checker without copying its prompts into Eval.

The source checkout is materialized below EVAL_CACHE_ROOT by the host.  This
bridge imports the pinned native evaluator and writes only aggregate booleans
and counts to the evidence path; the historical GPT-4 response file is never
accepted as input.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import stat
import sys
import zipfile
from pathlib import Path, PurePosixPath


# Never mutate the immutable materialized source with interpreter bytecode.
sys.dont_write_bytecode = True


EXCLUDED_RESPONSE_NAME = "input_response_data_gpt4_20231107_145030.jsonl"


def _contained(path: Path, root: Path, label: str) -> Path:
    resolved = path.resolve()
    try:
        resolved.relative_to(root.resolve())
    except ValueError as exc:
        raise ValueError(f"{label} must be below the materialized source root") from exc
    return resolved


def _metric(numerator: int, denominator: int) -> dict[str, float | int | None]:
    return {
        "numerator": numerator,
        "denominator": denominator,
        "accuracy": None if denominator == 0 else numerator / denominator,
    }


def _write_once(path: Path, payload: dict[str, object]) -> None:
    serialized = (json.dumps(payload, sort_keys=True) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as handle:
            handle.write(serialized)
    except FileExistsError:
        if path.read_bytes() != serialized:
            raise ValueError("append-only IFEval evidence path contains different bytes")


SMOKE_KEYS = (1000, 1012, 1069, 1005, 1098, 1019, 1040, 1122, 1108)
NLTK_RESOURCES = {
    "punkt_tab": "tokenizers/punkt_tab",
}
NLTK_DATA_BYTES = 4_319_076
NLTK_DATA_DIGEST = "e57f64187974277726a3417ca6f181ec5403676c717672eef6a748a7b20e0106"
NLTK_VERSION = "3.10.1"
NLTK_PREFLIGHT_TEXT = "One sentence. Two sentences."
NLTK_PREFLIGHT_TOKENS = ["One", "sentence", ".", "Two", "sentences", "."]


def _verify_nltk_data_archive() -> tuple[Path, bytes]:
    data_root = os.environ.get("NLTK_DATA")
    if not data_root or not Path(data_root).is_absolute():
        raise RuntimeError("IFEval requires an absolute NLTK_DATA runtime path")
    root = Path(data_root)
    tokenizers = root / "tokenizers"
    archive = tokenizers / "punkt_tab.zip"
    if root.is_symlink() or tokenizers.is_symlink() or archive.is_symlink():
        raise RuntimeError("IFEval runtime NLTK data must not use symlinks: punkt_tab")
    if not archive.is_file() or not stat.S_ISREG(archive.stat().st_mode):
        raise RuntimeError("IFEval runtime is missing preloaded NLTK data: punkt_tab")
    archive_bytes = archive.read_bytes()
    if len(archive_bytes) != NLTK_DATA_BYTES:
        raise RuntimeError("IFEval runtime NLTK data size drifted: punkt_tab")
    if hashlib.sha256(archive_bytes).hexdigest() != NLTK_DATA_DIGEST:
        raise RuntimeError("IFEval runtime NLTK data digest drifted: punkt_tab")
    return root.resolve(), archive_bytes


def _safe_archive_parts(name: str) -> tuple[str, ...]:
    if not name or name.startswith(("/", "\\")) or "\\" in name:
        raise RuntimeError("IFEval runtime NLTK archive contains an unsafe path")
    raw_parts = name.rstrip("/").split("/")
    if any(part in {"", ".", ".."} for part in raw_parts):
        raise RuntimeError("IFEval runtime NLTK archive contains an unsafe path")
    parts = PurePosixPath(name).parts
    if not parts or parts[0] != "punkt_tab":
        raise RuntimeError("IFEval runtime NLTK archive root drifted: punkt_tab")
    return parts


def _verify_extracted_nltk_data(
    data_root: Path, archive_bytes: bytes
) -> tuple[int, int]:
    tokenizers = data_root / "tokenizers"
    extracted_root = tokenizers / "punkt_tab"
    if extracted_root.is_symlink() or not extracted_root.is_dir():
        raise RuntimeError(
            "IFEval runtime is missing extracted NLTK data: punkt_tab"
        )

    for entry in tokenizers.iterdir():
        if entry.name not in {"punkt_tab.zip", "punkt_tab"}:
            raise RuntimeError(
                "IFEval runtime NLTK tokenizers scope contains an unexpected entry"
            )
        if entry.is_symlink():
            raise RuntimeError(
                "IFEval runtime NLTK data must not use symlinks: punkt_tab"
            )

    try:
        package = zipfile.ZipFile(io.BytesIO(archive_bytes))
    except (OSError, zipfile.BadZipFile) as exc:
        raise RuntimeError("IFEval runtime NLTK archive is invalid: punkt_tab") from exc

    with package:
        infos = package.infolist()
        names = [info.filename for info in infos]
        if len(names) != len(set(names)):
            raise RuntimeError("IFEval runtime NLTK archive has duplicate entries")

        expected_files: dict[str, zipfile.ZipInfo] = {}
        expected_directories = {"punkt_tab"}
        for info in infos:
            parts = _safe_archive_parts(info.filename)
            if info.flag_bits & 0x1:
                raise RuntimeError("IFEval runtime NLTK archive is encrypted")
            if stat.S_ISLNK(info.external_attr >> 16):
                raise RuntimeError("IFEval runtime NLTK archive contains a symlink")
            path = PurePosixPath(*parts).as_posix()
            for index in range(1, len(parts)):
                expected_directories.add(PurePosixPath(*parts[:index]).as_posix())
            if info.is_dir():
                expected_directories.add(path)
            else:
                expected_files[path] = info

        actual_files: set[str] = set()
        actual_directories = {"punkt_tab"}
        for path in extracted_root.rglob("*"):
            relative = path.relative_to(tokenizers).as_posix()
            if path.is_symlink():
                raise RuntimeError(
                    "IFEval runtime extracted NLTK data contains a symlink"
                )
            if path.is_dir():
                actual_directories.add(relative)
            elif path.is_file() and stat.S_ISREG(path.stat().st_mode):
                actual_files.add(relative)
            else:
                raise RuntimeError(
                    "IFEval runtime extracted NLTK data contains an unsupported entry"
                )

        if actual_files != set(expected_files):
            raise RuntimeError(
                "IFEval runtime extracted NLTK data file census drifted: punkt_tab"
            )
        if actual_directories != expected_directories:
            raise RuntimeError(
                "IFEval runtime extracted NLTK data directory census drifted: punkt_tab"
            )

        extracted_bytes = 0
        for relative, info in expected_files.items():
            path = tokenizers / relative
            actual = path.read_bytes()
            if len(actual) != info.file_size or actual != package.read(info):
                raise RuntimeError(
                    f"IFEval runtime extracted data drifted: {relative}"
                )
            extracted_bytes += len(actual)
        return len(expected_files), extracted_bytes


def _verify_nltk_can_use_extracted_data(data_root: Path) -> str:
    import nltk  # type: ignore[import-not-found]

    version = str(getattr(nltk, "__version__", "unknown"))
    if version != NLTK_VERSION:
        raise RuntimeError(
            f"IFEval runtime NLTK version drifted: expected {NLTK_VERSION}, got {version}"
        )
    nltk.data.path[:] = [str(data_root)]
    resource_path = NLTK_RESOURCES["punkt_tab"]
    try:
        located = Path(str(nltk.data.find(resource_path))).resolve()
    except LookupError as exc:
        raise RuntimeError(
            "IFEval runtime is missing preloaded NLTK data: punkt_tab"
        ) from exc
    expected = (data_root / resource_path).resolve()
    if located != expected:
        raise RuntimeError("IFEval runtime NLTK lookup escaped its runtime path")
    try:
        tokens = nltk.word_tokenize(NLTK_PREFLIGHT_TEXT)
    except Exception as exc:
        raise RuntimeError(
            "IFEval runtime extracted NLTK data is not usable: punkt_tab"
        ) from exc
    if tokens != NLTK_PREFLIGHT_TOKENS:
        raise RuntimeError("IFEval runtime NLTK tokenization probe drifted")
    return version


def _preflight_offline_nltk_data() -> dict[str, object]:
    """Verify pinned runtime bytes and their NLTK-usable extracted projection."""
    data_root, archive_bytes = _verify_nltk_data_archive()
    extracted_file_count, extracted_bytes = _verify_extracted_nltk_data(
        data_root, archive_bytes
    )
    nltk_version = _verify_nltk_can_use_extracted_data(data_root)
    return {
        "schema": "coffee-chat-eval/ifeval-runtime-asset-preflight-v1",
        "status": "verified",
        "asset": "nltk_data/tokenizers/punkt_tab.zip",
        "assetBytes": NLTK_DATA_BYTES,
        "assetDigest": f"sha256:{NLTK_DATA_DIGEST}",
        "extractedFileCount": extracted_file_count,
        "extractedBytes": extracted_bytes,
        "nltkVersion": nltk_version,
        "resource": NLTK_RESOURCES["punkt_tab"],
        "integrityOnly": True,
        "rightsCleared": False,
    }


def _require_offline_nltk_data() -> None:
    """Fail before evaluation unless the runtime already holds NLTK data."""
    _preflight_offline_nltk_data()


def _select_inputs(inputs, profile: str, keys: list[int] | None):
    if profile not in {"fixture", "smoke", "pilot", "score"}:
        raise ValueError(f"unsupported IFEval profile: {profile}")
    if keys is None:
        if profile == "fixture":
            keys = [SMOKE_KEYS[0]]
        elif profile in {"smoke", "pilot"}:
            keys = list(SMOKE_KEYS)
        else:
            return list(inputs)
    by_key = {int(item.key): item for item in inputs}
    missing = [key for key in keys if key not in by_key]
    if missing:
        raise ValueError(f"IFEval selected keys are missing from source: {missing}")
    if len(set(keys)) != len(keys):
        raise ValueError("IFEval selected keys must be unique")
    return [by_key[key] for key in keys]


def run(
    source_root: Path,
    input_data: Path,
    response_data: Path,
    output: Path,
    profile: str = "score",
    keys: list[int] | None = None,
) -> None:
    if response_data.name == EXCLUDED_RESPONSE_NAME:
        raise ValueError("historical IFEval responses are excluded")
    input_data = _contained(input_data, source_root, "input_data")
    source_root = source_root.resolve()
    package_root = source_root / "instruction_following_eval"
    if not package_root.is_dir():
        package_root = source_root
    sys.path.insert(0, str(package_root.parent))
    _require_offline_nltk_data()

    from instruction_following_eval import evaluation_lib  # type: ignore[import-not-found]

    inputs = evaluation_lib.read_prompt_list(str(input_data))
    inputs = _select_inputs(inputs, profile, keys)
    responses = evaluation_lib.read_prompt_to_response_dict(str(response_data))
    if profile == "score" and len(inputs) != 541:
        raise ValueError(f"expected 541 IFEval prompts, got {len(inputs)}")
    missing_responses = [item.key for item in inputs if item.prompt not in responses]
    if missing_responses:
        raise ValueError(f"missing candidate responses for IFEval keys: {missing_responses}")

    strict = [evaluation_lib.test_instruction_following_strict(item, responses) for item in inputs]
    loose = [evaluation_lib.test_instruction_following_loose(item, responses) for item in inputs]
    strict_instruction = [value for item in strict for value in item.follow_instruction_list]
    loose_instruction = [value for item in loose for value in item.follow_instruction_list]
    result = {
        "schema": "coffee-chat-eval/ifeval-native-v1",
        "source": {
            "repository": "https://github.com/google-research/google-research",
            "commit": "e6890f85757dd84e27ca6df2dd30651dafad28e0",
            "inputCount": len(inputs),
            "profile": profile,
            "keys": [int(item.key) for item in inputs],
        },
        "metrics": {
            "strictPrompt": _metric(sum(item.follow_all_instructions for item in strict), len(strict)),
            "strictInstruction": _metric(sum(strict_instruction), len(strict_instruction)),
            "loosePrompt": _metric(sum(item.follow_all_instructions for item in loose), len(loose)),
            "looseInstruction": _metric(sum(loose_instruction), len(loose_instruction)),
        },
    }
    _write_once(output, result)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preflight-only", action="store_true")
    parser.add_argument("--source-root", type=Path)
    parser.add_argument("--input-data", type=Path)
    parser.add_argument("--response-data", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--profile", choices=["fixture", "smoke", "pilot", "score"])
    parser.add_argument("--keys", type=str, default=None)
    args = parser.parse_args()
    if args.preflight_only:
        if any(
            value is not None
            for value in (
                args.source_root,
                args.input_data,
                args.response_data,
                args.output,
                args.profile,
                args.keys,
            )
        ):
            parser.error("--preflight-only cannot be combined with evaluation inputs")
        print(json.dumps(_preflight_offline_nltk_data(), sort_keys=True))
        return
    for label in ("source_root", "input_data", "response_data", "output"):
        value = getattr(args, label)
        if value is None:
            parser.error(f"--{label.replace('_', '-')} is required")
        if not value.is_absolute():
            raise SystemExit(f"{label} must be absolute")
    keys = None if args.keys is None else [int(value) for value in args.keys.split(",") if value]
    run(
        args.source_root,
        args.input_data,
        args.response_data,
        args.output,
        args.profile or "score",
        keys,
    )


if __name__ == "__main__":
    main()
