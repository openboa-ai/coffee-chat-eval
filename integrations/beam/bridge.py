#!/usr/bin/env python3
"""Run the pinned BEAM record-core evaluator through a host Judge broker."""

from __future__ import annotations

import argparse
import json
import sys
import types
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from typing import Any


CODE_COMMIT = "3e12035532eb85768f1a7cd779832b650c4b2ef9"
DATA_COMMIT = "3205395e897e7318c7b094ef4e6047b9b82dbb03"
CATEGORIES = (
    "abstention",
    "contradiction_resolution",
    "information_extraction",
    "knowledge_update",
    "multi_session_reasoning",
    "temporal_reasoning",
)


def _write_once(path: Path, payload: dict[str, Any]) -> None:
    serialized = (json.dumps(payload, sort_keys=True) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as handle:
            handle.write(serialized)
    except FileExistsError:
        if path.read_bytes() != serialized:
            raise ValueError("append-only BEAM evidence path contains different bytes")


def _query_count(query_path: Path) -> int:
    payload = json.loads(query_path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("BEAM query artifact must be a list")
    if any(not isinstance(item, dict) or item.get("category") not in CATEGORIES for item in payload):
        raise ValueError("BEAM query artifact contains an unadmitted category")
    return len(payload)


def _response_text(value: Any) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, dict):
        if isinstance(value.get("output_text"), str):
            return value["output_text"]
        output = value.get("output")
        if isinstance(output, list):
            chunks: list[str] = []
            for item in output:
                if isinstance(item, dict) and isinstance(item.get("content"), list):
                    for content in item["content"]:
                        if isinstance(content, dict) and isinstance(content.get("text"), str):
                            chunks.append(content["text"])
            if chunks:
                return "".join(chunks)
    return json.dumps(value)


class BrokerJudge:
    def __init__(self, runtime: dict[str, Any]) -> None:
        if runtime.get("scope") != "judge":
            raise ValueError("BEAM Judge runtime scope must be judge")
        self.endpoint = str(runtime["endpoint"])
        self.token = str(runtime["capabilityToken"])
        self.model = str(runtime["model"])
        self.calls = 0
        self.max_requests = int(runtime["maxRequests"])

    def invoke(self, prompt: Any) -> Any:
        if self.calls >= self.max_requests:
            raise RuntimeError("BEAM Judge capability request cap exceeded")
        body = json.dumps({"model": self.model, "input": prompt}).encode("utf-8")
        request = urllib.request.Request(
            self.endpoint,
            data=body,
            headers={"authorization": f"Bearer {self.token}", "content-type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.loads(response.read().decode("utf-8"))
        self.calls += 1
        return SimpleNamespace(content=_response_text(payload))


def _aggregate_native(
    evaluator_output: dict[str, Any],
    query_count: int,
    judge_calls: int,
    probing: dict[str, Any],
    responses: dict[str, Any],
    bypassed: bool,
) -> dict[str, Any]:
    categories: dict[str, dict[str, int | float | None]] = {}
    for category in CATEGORIES:
        values = evaluator_output.get(category)
        if not isinstance(values, list) or len(values) != 1:
            raise ValueError(f"BEAM native category denominator must be one: {category}")
        score = values[0].get("llm_judge_score") if isinstance(values[0], dict) else None
        if not isinstance(score, (int, float)):
            raise ValueError(f"BEAM native score is missing: {category}")
        truncated = int(float(score))
        categories[category] = {"numerator": truncated, "denominator": 1, "accuracy": truncated}
    placeholder = any("<question>" in str(item.get("llm_response", "")) for values in responses.values() if isinstance(values, list) for item in values if isinstance(item, dict))
    expected_calls = sum(len(probing[category][0]["rubric"]) for category in CATEGORIES)
    if judge_calls != expected_calls:
        raise ValueError(f"BEAM Judge census mismatch: expected {expected_calls}, got {judge_calls}")
    return {
        "schema": "coffee-chat-eval/beam-record-core-v1",
        "source": {"codeCommit": CODE_COMMIT, "dataCommit": DATA_COMMIT, "tier": "100K"},
        "queryCount": query_count,
        "judgeCalls": judge_calls,
        "unusedEmbeddingInitializationBypassed": bypassed,
        "partialCreditTruncation": True,
        "questionPlaceholderUnexpanded": True,
        "observedPlaceholder": placeholder,
        "paperComparable": False,
        "categories": categories,
    }


def run(
    source_root: Path,
    query_path: Path,
    response_path: Path,
    output: Path,
    profile: str = "score",
    data_root: Path | None = None,
    judge_runtime: Path | None = None,
) -> None:
    source_root = source_root.resolve()
    if not source_root.is_dir():
        raise ValueError("BEAM source root is missing")
    query_count = _query_count(query_path)
    expected = {"fixture": 1, "smoke": 6, "pilot": 12, "score": 240}.get(profile)
    if expected is None or query_count != expected:
        raise ValueError(f"BEAM query census mismatch for {profile}: expected {expected}, got {query_count}")
    responses = json.loads(response_path.read_text(encoding="utf-8"))
    if not isinstance(responses, dict):
        raise ValueError("BEAM response artifact must be an object")
    probing_path = source_root / "chats" / "100K" / "1" / "probing_questions" / "probing_questions.json"
    probing = json.loads(probing_path.read_text(encoding="utf-8"))
    if any(category not in probing or not isinstance(probing[category], list) for category in CATEGORIES):
        raise ValueError("BEAM probing rubric is incomplete")
    if data_root is not None and not data_root.is_dir():
        raise ValueError("BEAM data root is missing")
    if profile == "fixture":
        evaluator_output = {category: [{"llm_judge_score": 0}] for category in CATEGORIES}
        result = _aggregate_native(evaluator_output, query_count, sum(len(probing[category][0]["rubric"]) for category in CATEGORIES), probing, responses, True)
        _write_once(output, result)
        return
    if judge_runtime is None:
        raise ValueError("BEAM live evaluation requires a Judge runtime")
    runtime = json.loads(judge_runtime.read_text(encoding="utf-8"))
    # Prevent provider-bearing upstream wrappers from being imported.
    broker = BrokerJudge(runtime)
    sys.path.insert(0, str(source_root))
    sys.modules["src.llm"] = types.ModuleType("src.llm")
    sys.modules["src.llm"].gpt_llm = broker
    from src.evaluation import run_evaluation  # type: ignore[import-not-found]

    # The six selected scorers are LLM-only. Keep upstream scoring functions
    # intact and bypass only the unused embedding initialisation.
    run_evaluation.initialize_models = lambda: None
    run_evaluation.run_evaluation(
        probing_questions_address=str(probing_path),
        answers_directory=str(response_path),
        output_address=str(output.with_suffix(".upstream.json")),
        model=broker,
    )
    evaluator_output = json.loads(output.with_suffix(".upstream.json").read_text(encoding="utf-8"))
    result = _aggregate_native(evaluator_output, query_count, broker.calls, probing, responses, True)
    _write_once(output, result)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", type=Path, required=False)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=False)
    parser.add_argument("--query-path", type=Path, required=True)
    parser.add_argument("--response-path", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--tier", default="100K")
    parser.add_argument("--profile", choices=["fixture", "smoke", "pilot", "score"], default="score")
    parser.add_argument("--judge-runtime", type=Path, required=False)
    args = parser.parse_args()
    for label in ("source_root", "data_root", "query_path", "response_path", "output", "judge_runtime"):
        value = getattr(args, label)
        if value is not None and not value.is_absolute():
            raise SystemExit(f"{label} must be absolute")
    if args.tier != "100K":
        raise SystemExit("only BEAM 100K is admitted in v1")
    run(args.source_root, args.query_path, args.response_path, args.output, args.profile, args.data_root, args.judge_runtime)


if __name__ == "__main__":
    main()
