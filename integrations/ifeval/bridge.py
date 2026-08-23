#!/usr/bin/env python3
"""Run Google's pinned IFEval checker without copying its prompts into Eval.

The source checkout is materialized below EVAL_CACHE_ROOT by the host.  This
bridge imports the pinned native evaluator and writes only aggregate booleans
and counts to the evidence path; the historical GPT-4 response file is never
accepted as input.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


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
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--input-data", type=Path, required=True)
    parser.add_argument("--response-data", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--profile", choices=["fixture", "smoke", "pilot", "score"], default="score")
    parser.add_argument("--keys", type=str, default=None)
    args = parser.parse_args()
    for label in ("source_root", "input_data", "response_data", "output"):
        value = getattr(args, label)
        if not value.is_absolute():
            raise SystemExit(f"{label} must be absolute")
    keys = None if args.keys is None else [int(value) for value in args.keys.split(",") if value]
    run(args.source_root, args.input_data, args.response_data, args.output, args.profile, keys)


if __name__ == "__main__":
    main()
