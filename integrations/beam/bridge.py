#!/usr/bin/env python3
"""Run the pinned BEAM record-core evaluator through a host Judge broker."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
import types
import urllib.error
import urllib.request
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable


# The materialized upstream checkout is immutable during a run.
sys.dont_write_bytecode = True


CODE_COMMIT = "3e12035532eb85768f1a7cd779832b650c4b2ef9"
DATA_COMMIT = "3205395e897e7318c7b094ef4e6047b9b82dbb03"
DATA_FILE_DIGEST = "c0519be25907005ba873c927c50877471d550873039d96c041554d0075a78ace"
CATEGORIES = (
    "abstention",
    "contradiction_resolution",
    "information_extraction",
    "knowledge_update",
    "multi_session_reasoning",
    "temporal_reasoning",
)
NLTK_DOWNLOADS_BYPASSED = frozenset(("punkt", "punkt_tab"))
NLTK_DATA_FORBIDDEN = (
    "tokenizers/punkt",
    "tokenizers/punkt.zip",
    "tokenizers/punkt_tab",
    "tokenizers/punkt_tab.zip",
)
JUDGE_UNAVAILABLE_REASON = "BEAM Judge broker transport is unavailable"
JUDGE_FAILED_REASON = "BEAM Judge completion is invalid"
NONTERMINAL_RESPONSE_STATUSES = frozenset(("queued", "in_progress", "incomplete"))


class JudgeUnavailableError(RuntimeError):
    pass


class JudgeFailedError(RuntimeError):
    pass


def _install_unused_embedding_stub() -> None:
    """Keep BEAM's unused embedding imports out of the LLM-only runtime.

    ``compute_metrics`` imports sentence-transformers at module import time,
    although the six admitted record-core scorers never call its embedding
    functions.  Installing a fail-closed stub preserves the upstream scorer
    source while preventing a GPU/torch dependency from entering the runner.
    """
    try:
        import sentence_transformers  # type: ignore[import-not-found]  # noqa: F401
        return
    except ModuleNotFoundError:
        pass

    module = types.ModuleType("sentence_transformers")

    class EmbeddingUnavailable:
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            raise RuntimeError("BEAM embedding initialization is bypassed for record-core")

    module.SentenceTransformer = EmbeddingUnavailable  # type: ignore[attr-defined]
    module.util = types.SimpleNamespace()  # type: ignore[attr-defined]
    sys.modules["sentence_transformers"] = module


def _install_offline_nltk_guard() -> Callable[[], None]:
    """Bypass only import-time downloads unused by record-core scorers."""
    data_root = os.environ.get("NLTK_DATA")
    if not data_root or not Path(data_root).is_absolute():
        raise RuntimeError("BEAM requires an absolute NLTK_DATA runtime path")
    for relative_path in NLTK_DATA_FORBIDDEN:
        candidate = Path(data_root) / relative_path
        if candidate.exists() or candidate.is_symlink():
            raise RuntimeError(f"BEAM Punkt data is not admitted: {relative_path}")
    import nltk  # type: ignore[import-not-found]

    # Prevent accidental use of ambient user or system NLTK data. The six
    # admitted scorers are Judge-only and never tokenize; if that changes,
    # NLTK will fail closed against this evaluator-owned runtime path.
    nltk.data.path[:] = [data_root]
    import_downloads: list[str] = []

    def offline_download(resource: str, *_args: Any, **_kwargs: Any) -> bool:
        if resource not in NLTK_DOWNLOADS_BYPASSED:
            raise RuntimeError(f"BEAM attempted an unadmitted NLTK download: {resource}")
        import_downloads.append(resource)
        return True

    nltk.download = offline_download

    def seal() -> None:
        if tuple(import_downloads) != ("punkt", "punkt_tab"):
            raise RuntimeError("BEAM upstream NLTK import calls drifted")

        def blocked_use(*_args: Any, **_kwargs: Any) -> Any:
            raise RuntimeError("BEAM NLTK use is not admitted after upstream import")

        nltk.download = blocked_use
        nltk.word_tokenize = blocked_use
        nltk.sent_tokenize = blocked_use

    return seal


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


def _response_category_map(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or not value:
        raise ValueError(f"BEAM {label} response categories must be a non-empty object")
    unadmitted = sorted(str(key) for key in value if key not in CATEGORIES)
    if unadmitted:
        raise ValueError(
            f"BEAM {label} response contains an unadmitted category: "
            + ", ".join(unadmitted)
        )
    if any(not isinstance(responses, list) for responses in value.values()):
        raise ValueError(f"BEAM {label} response category values must be lists")
    return value


def _response_text(value: Any) -> str:
    if isinstance(value, dict):
        if isinstance(value.get("output_text"), str) and value["output_text"]:
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
    raise JudgeFailedError(JUDGE_FAILED_REASON)


def _extract_conversation(data_root: Path, conversation_id: str) -> dict[str, Any]:
    """Read only the pinned conversation column from the admitted parquet.

    Probing questions and rubrics are intentionally not returned.  They stay
    in the evaluator process; the candidate receives the conversation and the
    selected question as separate input fields.
    """
    try:
        import pyarrow.parquet as parquet  # type: ignore[import-not-found]
    except ModuleNotFoundError as exc:
        raise RuntimeError("BEAM conversation extraction requires pyarrow") from exc
    data_file = data_root / "data" / "100K-00000-of-00001.parquet"
    if not data_file.is_file():
        raise ValueError("BEAM pinned 100K parquet is missing")
    table = parquet.read_table(
        data_file,
        columns=["conversation_id", "chat"],
    )
    target = conversation_id.rsplit("/", 1)[-1]
    rows = table.to_pylist()
    row = next((item for item in rows if str(item.get("conversation_id")) == target), None)
    if row is None:
        raise ValueError(f"BEAM conversation is missing: {conversation_id}")
    return {
        "conversationId": conversation_id,
        "messages": row.get("chat"),
    }


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
        body = json.dumps(
            {"model": self.model, "input": prompt, "store": False}
        ).encode("utf-8")
        request = urllib.request.Request(
            self.endpoint,
            data=body,
            headers={"authorization": f"Bearer {self.token}", "content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                response_bytes = response.read()
        except (urllib.error.HTTPError, urllib.error.URLError, OSError) as exc:
            raise JudgeUnavailableError(JUDGE_UNAVAILABLE_REASON) from exc
        try:
            payload = json.loads(response_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise JudgeFailedError(JUDGE_FAILED_REASON) from exc
        self.calls += 1
        if not isinstance(payload, dict):
            raise JudgeFailedError(JUDGE_FAILED_REASON)
        status = payload.get("status")
        if status in NONTERMINAL_RESPONSE_STATUSES:
            raise JudgeUnavailableError(JUDGE_UNAVAILABLE_REASON)
        if payload.get("error") is not None:
            raise JudgeFailedError(JUDGE_FAILED_REASON)
        if status != "completed":
            raise JudgeFailedError(JUDGE_FAILED_REASON)
        content = _response_text(payload)
        try:
            parsed = json.loads(content)
        except json.JSONDecodeError as exc:
            raise JudgeFailedError(JUDGE_FAILED_REASON) from exc
        if not isinstance(parsed, dict):
            raise JudgeFailedError(JUDGE_FAILED_REASON)
        score = parsed.get("score")
        if (
            isinstance(score, bool)
            or not isinstance(score, (int, float))
            or not math.isfinite(float(score))
            or float(score) not in {0.0, 0.5, 1.0}
        ):
            raise JudgeFailedError(JUDGE_FAILED_REASON)
        return SimpleNamespace(content=content)


def _aggregate_native(
    evaluator_outputs: list[dict[str, Any]],
    query_count: int,
    judge_calls: int,
    probing_by_conversation: dict[str, dict[str, Any]],
    responses_by_conversation: dict[str, dict[str, Any]],
    bypassed: bool,
) -> dict[str, Any]:
    categories: dict[str, dict[str, int | float | None]] = {}
    for category in CATEGORIES:
        values: list[Any] = []
        for evaluator_output in evaluator_outputs:
            output_values = evaluator_output.get(category)
            if not isinstance(output_values, list):
                raise ValueError(f"BEAM native category is missing: {category}")
            values.extend(output_values)
        expected_denominator = sum(
            len(responses_by_conversation.get(conversation, {}).get(category, []))
            for conversation in responses_by_conversation
        )
        if len(values) != expected_denominator:
            raise ValueError(
                f"BEAM native category denominator mismatch: {category}"
            )
        numerator = 0
        for value in values:
            score = value.get("llm_judge_score") if isinstance(value, dict) else None
            if not isinstance(score, (int, float)):
                raise ValueError(f"BEAM native score is missing: {category}")
            numerator += int(float(score))
        categories[category] = {
            "numerator": numerator,
            "denominator": expected_denominator,
            "accuracy": None if expected_denominator == 0 else numerator / expected_denominator,
        }
    placeholder = any(
        "<question>" in str(item.get("llm_response", ""))
        for responses in responses_by_conversation.values()
        for values in responses.values()
        if isinstance(values, list)
        for item in values
        if isinstance(item, dict)
    )
    expected_calls = sum(
        len(probing[category][index]["rubric"])
        for conversation, probing in probing_by_conversation.items()
        for category, responses in responses_by_conversation[conversation].items()
        for index in range(len(responses))
    )
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
    raw_responses = json.loads(response_path.read_text(encoding="utf-8"))
    if not isinstance(raw_responses, dict):
        raise ValueError("BEAM response artifact must be an object")
    # Older fixture artifacts used the single-conversation category map. Keep
    # accepting that shape while the sampled/full runner writes an explicit
    # conversation -> category map.
    if any(key in CATEGORIES for key in raw_responses):
        responses_by_conversation: dict[str, dict[str, Any]] = {
            "100K/1": _response_category_map(raw_responses, "legacy")
        }
    else:
        responses_by_conversation = {
            conversation: _response_category_map(category_map, conversation)
            for conversation, category_map in raw_responses.items()
        }
    probing_by_conversation: dict[str, dict[str, Any]] = {}
    for conversation in responses_by_conversation:
        probing_path = (
            source_root
            / "chats"
            / conversation
            / "probing_questions"
            / "probing_questions.json"
        )
        probing = json.loads(probing_path.read_text(encoding="utf-8"))
        if any(
            category not in probing or not isinstance(probing[category], list)
            for category in CATEGORIES
        ):
            raise ValueError("BEAM probing rubric is incomplete")
        probing_by_conversation[conversation] = probing
    data_verified = False
    if data_root is not None:
        if not data_root.is_dir():
            raise ValueError("BEAM data root is missing")
        data_file = data_root / "data" / "100K-00000-of-00001.parquet"
        if not data_file.is_file():
            raise ValueError("BEAM pinned 100K parquet is missing")
        actual_data_digest = hashlib.sha256(data_file.read_bytes()).hexdigest()
        if actual_data_digest != DATA_FILE_DIGEST:
            raise ValueError("BEAM pinned 100K parquet digest drifted")
        data_verified = True
    if profile != "fixture" and not data_verified:
        raise ValueError("BEAM live evaluation requires the pinned 100K data root")
    if profile == "fixture":
        evaluator_output = {
            category: [
                {"llm_judge_score": 0}
                for _ in responses_by_conversation.get("100K/1", {}).get(category, [])
            ]
            for category in CATEGORIES
        }
        result = _aggregate_native(
            [evaluator_output],
            query_count,
            sum(
                len(probing[category][index]["rubric"])
                for conversation, probing in probing_by_conversation.items()
                for category, responses in responses_by_conversation[conversation].items()
                for index in range(len(responses))
            ),
            probing_by_conversation,
            responses_by_conversation,
            True,
        )
        result["dataFileDigestVerified"] = data_verified
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
    _install_unused_embedding_stub()
    seal_nltk = _install_offline_nltk_guard()
    from src.evaluation import run_evaluation  # type: ignore[import-not-found]
    seal_nltk()

    # The six selected scorers are LLM-only. Keep upstream scoring functions
    # intact and bypass only the unused embedding initialisation.
    run_evaluation.initialize_models = lambda: None
    evaluator_outputs: list[dict[str, Any]] = []
    for index, (conversation, responses) in enumerate(responses_by_conversation.items()):
        probing_path = (
            source_root
            / "chats"
            / conversation
            / "probing_questions"
            / "probing_questions.json"
        )
        answers_path = output.with_name(f"{output.stem}.upstream-input-{index}.json")
        upstream_output = output.with_name(f"{output.stem}.upstream-{index}.json")
        answers_path.write_text(json.dumps(responses), encoding="utf-8")
        run_evaluation.run_evaluation(
            probing_questions_address=str(probing_path),
            answers_directory=str(answers_path),
            output_address=str(upstream_output),
            model=broker,
        )
        evaluator_outputs.append(json.loads(upstream_output.read_text(encoding="utf-8")))
    result = _aggregate_native(
        evaluator_outputs,
        query_count,
        broker.calls,
        probing_by_conversation,
        responses_by_conversation,
        True,
    )
    result["dataFileDigestVerified"] = data_verified
    _write_once(output, result)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", type=Path, required=False)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--data-root", type=Path, required=False)
    parser.add_argument("--conversation-id", required=False)
    parser.add_argument("--extract-conversation", action="store_true")
    parser.add_argument("--query-path", type=Path, required=False)
    parser.add_argument("--response-path", type=Path, required=False)
    parser.add_argument("--output", type=Path, required=False)
    parser.add_argument("--tier", default="100K")
    parser.add_argument("--profile", choices=["fixture", "smoke", "pilot", "score"], default="score")
    parser.add_argument("--judge-runtime", type=Path, required=False)
    args = parser.parse_args()
    for label in ("source_root", "data_root", "query_path", "response_path", "output", "judge_runtime"):
        value = getattr(args, label)
        if value is not None and not value.is_absolute():
            raise SystemExit(f"{label} must be absolute")
    if args.extract_conversation:
        if args.data_root is None or args.conversation_id is None:
            raise SystemExit("conversation extraction requires --data-root and --conversation-id")
        print(json.dumps(_extract_conversation(args.data_root, args.conversation_id)))
        return
    if args.query_path is None or args.response_path is None or args.output is None:
        raise SystemExit("evaluation requires --query-path, --response-path, and --output")
    if args.tier != "100K":
        raise SystemExit("only BEAM 100K is admitted in v1")
    try:
        run(args.source_root, args.query_path, args.response_path, args.output, args.profile, args.data_root, args.judge_runtime)
    except JudgeUnavailableError:
        _write_once(
            args.output,
            {
                "schema": "coffee-chat-eval/beam-bridge-outcome-v1",
                "executionStatus": "unavailable",
                "failureOwner": "judge",
                "reason": JUDGE_UNAVAILABLE_REASON,
            },
        )
    except JudgeFailedError:
        _write_once(
            args.output,
            {
                "schema": "coffee-chat-eval/beam-bridge-outcome-v1",
                "executionStatus": "failed",
                "failureOwner": "judge",
                "reason": JUDGE_FAILED_REASON,
            },
        )


if __name__ == "__main__":
    main()
