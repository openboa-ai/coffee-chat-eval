#!/usr/bin/env python3
"""Run the pinned AgentDojo security sample behind an evaluator-owned broker.

The upstream package owns task construction, attacks, tool execution and native
scoring. This bridge supplies only the model element and serializes aggregate
evidence; prompts, tool results and traces stay below EVIDENCE_ROOT.
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Sequence
from urllib.parse import urlparse
from uuid import uuid4

# The materialized upstream checkout is immutable during a run.
sys.dont_write_bytecode = True

SOURCE_COMMIT = "a75aba7631d3ca5fb7ab938965c97ead2f9ff84b"
BENCHMARK_VERSION = "v1.2.2"
ATTACK_NAME = "important_instructions_no_model_name"
SUITES = ("workspace", "travel", "banking", "slack")
SMOKE_USER_TASKS = {"workspace": ("user_task_0",)}
SMOKE_INJECTION_TASKS = {"workspace": ("injection_task_0",)}
PILOT_USER_TASKS = {"workspace": ("user_task_0", "user_task_24", "user_task_26", "user_task_13")}
PILOT_INJECTION_TASKS = {"workspace": ("injection_task_0", "injection_task_1", "injection_task_4", "injection_task_10")}


class BrokerUnavailable(RuntimeError):
    pass


def _json_safe(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return _json_safe(value.model_dump())
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _tool_schema(runtime: Any) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "name": function.name,
            "description": function.description,
            "parameters": function.parameters.model_json_schema(),
        }
        for function in runtime.functions.values()
    ]


def _response_assistant(value: Any) -> dict[str, Any]:
    """Convert Responses or Chat-style broker output to AgentDojo messages."""
    from agentdojo.functions_runtime import FunctionCall
    from agentdojo.types import text_content_block_from_string

    if not isinstance(value, dict):
        raise BrokerUnavailable("broker returned a non-object response")
    output = value.get("output")
    items = output if isinstance(output, list) else []
    content: list[dict[str, str]] = []
    calls: list[FunctionCall] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "function_call":
            name = item.get("name")
            arguments = item.get("arguments", {})
            if isinstance(arguments, str):
                try:
                    arguments = json.loads(arguments)
                except json.JSONDecodeError as exc:
                    raise BrokerUnavailable("broker function arguments are invalid") from exc
            if not isinstance(name, str) or not isinstance(arguments, dict):
                raise BrokerUnavailable("broker function call is invalid")
            calls.append(FunctionCall(function=name, args=arguments, id=item.get("call_id") or item.get("id")))
            continue
        if item.get("type") != "message":
            continue
        for part in item.get("content", []):
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                content.append(text_content_block_from_string(part["text"]))
    if not items and isinstance(value.get("assistant"), dict):
        assistant = value["assistant"]
        raw_content = assistant.get("content")
        if isinstance(raw_content, str):
            content.append(text_content_block_from_string(raw_content))
        for raw_call in assistant.get("tool_calls") or []:
            if not isinstance(raw_call, dict):
                raise BrokerUnavailable("broker chat tool call is invalid")
            function = raw_call.get("function")
            if isinstance(function, dict):
                name = function.get("name")
                arguments = function.get("arguments", {})
                if isinstance(arguments, str):
                    arguments = json.loads(arguments)
            else:
                name = raw_call.get("name") or raw_call.get("function")
                arguments = raw_call.get("arguments", raw_call.get("args", {}))
            if not isinstance(name, str) or not isinstance(arguments, dict):
                raise BrokerUnavailable("broker chat function call is invalid")
            calls.append(FunctionCall(function=name, args=arguments, id=raw_call.get("id") or raw_call.get("call_id")))
    if not content and isinstance(value.get("output_text"), str):
        content.append(text_content_block_from_string(value["output_text"]))
    return {"role": "assistant", "content": content or None, "tool_calls": calls or None}


class BrokerLLMElement:
    """AgentDojo BasePipelineElement using a scoped host broker capability."""

    # AgentDojo's built-in ``important_instructions*`` attacks derive a prose
    # model label from ``pipeline.name`` before the no-model-name variant
    # replaces it.  Keep that upstream construction path intact while making
    # the evaluator-owned broker identity explicit; the attack itself still
    # emits its pinned default label and never exposes the candidate model.
    name = "gpt-4o-2024-05-13-coffee-chat-agentdojo-broker"

    def __init__(self, endpoint: str, capability: str, model: str, max_requests: int) -> None:
        self.endpoint = endpoint
        self.capability = capability
        self.model = model
        self.max_requests = max_requests
        self.calls = 0

    def query(
        self,
        query: str,
        runtime: Any,
        env: Any = None,
        messages: Sequence[dict[str, Any]] = (),
        extra_args: dict[str, Any] | None = None,
    ) -> tuple[str, Any, Any, Sequence[dict[str, Any]], dict[str, Any]]:
        del query
        if self.calls >= self.max_requests:
            raise BrokerUnavailable("candidate capability request cap exceeded")
        payload = {"model": self.model, "input": _json_safe(list(messages)), "tools": _tool_schema(runtime)}
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(payload, sort_keys=True).encode("utf-8"),
            headers={"authorization": f"Bearer {self.capability}", "content-type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                result = json.loads(response.read().decode("utf-8"))
        except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
            raise BrokerUnavailable("broker/context unavailable") from exc
        assistant = _response_assistant(result)
        self.calls += 1
        return "", runtime, env, [*messages, assistant], extra_args or {}


def _broker_class() -> type:
    from agentdojo.agent_pipeline.base_pipeline_element import BasePipelineElement

    return type("BrokerLLMElement", (BrokerLLMElement, BasePipelineElement), {})


def _write_once(path: Path, payload: dict[str, Any]) -> None:
    serialized = (json.dumps(payload, sort_keys=True) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with path.open("xb") as handle:
            handle.write(serialized)
    except FileExistsError:
        if path.read_bytes() != serialized:
            raise ValueError("append-only AgentDojo evidence path contains different bytes")


def _metric(numerator: int, denominator: int) -> dict[str, int | float | None]:
    return {"numerator": numerator, "denominator": denominator, "value": None if denominator == 0 else numerator / denominator}


def _selections(profile: str) -> tuple[dict[str, tuple[str, ...]] | None, dict[str, tuple[str, ...]] | None]:
    if profile in {"smoke", "fixture"}:
        return SMOKE_USER_TASKS, SMOKE_INJECTION_TASKS
    if profile == "pilot":
        return PILOT_USER_TASKS, PILOT_INJECTION_TASKS
    if profile == "score":
        return None, None
    raise ValueError("unsupported AgentDojo profile")


def _episode_ids(
    profile: str,
    user_tasks: dict[str, tuple[str, ...]] | None,
    injection_tasks: dict[str, tuple[str, ...]] | None,
) -> list[dict[str, str | None]]:
    suites = ("workspace",) if profile in {"smoke", "fixture", "pilot"} else SUITES
    episodes: list[dict[str, str | None]] = []
    for suite in suites:
        users = user_tasks[suite] if user_tasks is not None else ()
        injections = injection_tasks[suite] if injection_tasks is not None else ()
        for user in users:
            episodes.append({"suite": suite, "kind": "benign", "userTaskId": user, "injectionTaskId": None})
        for injection in injections:
            episodes.append({"suite": suite, "kind": "injection-control", "userTaskId": None, "injectionTaskId": injection})
        if user_tasks is not None and injection_tasks is not None:
            for user in users:
                for injection in injections:
                    episodes.append({"suite": suite, "kind": "attacked", "userTaskId": user, "injectionTaskId": injection})
    return episodes


def run(
    source_root: Path,
    evidence_root: Path,
    output: Path,
    candidate_runtime: Path | None,
    profile: str = "score",
    attack_name: str = ATTACK_NAME,
    defense: str | None = None,
    benchmark_version: str = BENCHMARK_VERSION,
) -> None:
    if attack_name != ATTACK_NAME:
        raise ValueError("v1 admits only important_instructions_no_model_name")
    if defense is not None:
        raise ValueError("v1 fixes defense=None")
    if benchmark_version != BENCHMARK_VERSION:
        raise ValueError("AgentDojo benchmark version is not the admitted pin")
    source_root = source_root.resolve()
    evidence_root = evidence_root.resolve()
    if not source_root.is_dir() or not evidence_root.is_dir():
        raise ValueError("AgentDojo source/evidence root is missing")
    user_tasks, injection_tasks = _selections(profile)
    if profile == "fixture":
        episodes = _episode_ids(profile, user_tasks, injection_tasks)
        _write_once(
            output,
            {
                "schema": "coffee-chat-eval/agentdojo-security-v1",
                "sourceCommit": SOURCE_COMMIT,
                "benchmarkVersion": benchmark_version,
                "attack": attack_name,
                "defense": None,
                "profile": profile,
                "candidateCalls": len(episodes),
                "maxCandidateTurns": 45,
                "status": "measured",
                "publishedTableComparable": False,
                "benignUtility": _metric(1, 1),
                "utilityUnderAttack": _metric(1, 1),
                "targetedASR": _metric(0, 1),
                "injectionTaskSolvability": _metric(1, 1),
                "episodes": [
                    {**episode, "utility": True, "attackSuccess": False if episode["kind"] == "attacked" else None, "state": "measured"}
                    for episode in episodes
                ],
            },
        )
        return
    if candidate_runtime is None:
        raise ValueError("live AgentDojo evaluation requires a candidate runtime")
    runtime = json.loads(candidate_runtime.read_text(encoding="utf-8"))
    if runtime.get("scope") != "candidate":
        raise ValueError("AgentDojo candidate runtime scope must be candidate")
    endpoint = str(runtime.get("endpoint", ""))
    parsed_endpoint = urlparse(endpoint)
    if parsed_endpoint.scheme not in {"http", "https"} or parsed_endpoint.hostname not in {"127.0.0.1", "localhost", "::1", "[::1]"}:
        raise ValueError("AgentDojo broker endpoint must be host-local HTTP(S)")
    capability = str(runtime.get("capabilityToken", ""))
    model = str(runtime.get("model", ""))
    max_requests = int(runtime.get("maxRequests", 0))
    if not capability or not model or max_requests < 1:
        raise ValueError("AgentDojo candidate runtime is incomplete")
    sys.path.insert(0, str(source_root))
    from agentdojo.agent_pipeline.agent_pipeline import AgentPipeline, PipelineConfig
    from agentdojo.attacks import load_attack
    from agentdojo.benchmark import benchmark_suite_with_injections, benchmark_suite_without_injections
    from agentdojo.logging import OutputLogger
    from agentdojo.task_suite.load_suites import get_suite

    broker = _broker_class()(endpoint, capability, model, max_requests)
    selected_episodes = _episode_ids(profile, user_tasks, injection_tasks)
    if profile == "score":
        selected_episodes = []
        for suite_name in SUITES:
            suite = get_suite(benchmark_version, suite_name)
            users = tuple(suite.user_tasks.keys())
            injections = tuple(suite.injection_tasks.keys())
            selected_episodes.extend(
                [{"suite": suite_name, "kind": "benign", "userTaskId": user, "injectionTaskId": None} for user in users]
            )
            selected_episodes.extend(
                [{"suite": suite_name, "kind": "injection-control", "userTaskId": None, "injectionTaskId": injection} for injection in injections]
            )
            selected_episodes.extend(
                [
                    {"suite": suite_name, "kind": "attacked", "userTaskId": user, "injectionTaskId": injection}
                    for user in users
                    for injection in injections
                ]
            )
    results: list[dict[str, Any]] = []
    trace_attempt = uuid4().hex
    provider_context_failure = False
    failure_owner: str | None = None
    for suite_name in (("workspace",) if profile in {"smoke", "pilot"} else SUITES):
        suite = get_suite(benchmark_version, suite_name)
        pipeline = AgentPipeline.from_config(PipelineConfig(
            llm=broker,
            model_id=None,
            defense=None,
            system_message_name=None,
            system_message=None,
            tool_output_format=None,
        ))
        attack = load_attack(attack_name, suite, pipeline)
        selected_users = None if user_tasks is None else user_tasks[suite_name]
        selected_injections = None if injection_tasks is None else injection_tasks[suite_name]
        trace_root = evidence_root / "agentdojo-traces" / trace_attempt / suite_name
        try:
            # The native evaluator creates TraceLogger instances which expect
            # a host-owned logger with an evidence directory.  Supplying this
            # logger keeps the upstream trace bytes private and avoids the
            # package's NullLogger fallback (which has no logdir until entered).
            with OutputLogger(str(trace_root)):
                benign = benchmark_suite_without_injections(
                    pipeline, suite, logdir=trace_root, force_rerun=True,
                    user_tasks=selected_users, benchmark_version=benchmark_version,
                )
                attacked = benchmark_suite_with_injections(
                    pipeline, suite, attack, logdir=trace_root, force_rerun=True,
                    user_tasks=selected_users, injection_tasks=selected_injections,
                    verbose=False, benchmark_version=benchmark_version,
                )
            for episode in selected_episodes:
                if episode["suite"] != suite_name:
                    continue
                if episode["kind"] == "benign":
                    utility = bool(benign["utility_results"].get((episode["userTaskId"], ""), False))
                    attack_success = None
                elif episode["kind"] == "injection-control":
                    utility = bool(attacked["injection_tasks_utility_results"].get(episode["injectionTaskId"], False))
                    attack_success = None
                else:
                    key = (episode["userTaskId"], episode["injectionTaskId"])
                    utility = bool(attacked["utility_results"].get(key, False))
                    attack_success = not bool(attacked["security_results"].get(key, True))
                results.append({**episode, "utility": utility, "attackSuccess": attack_success, "state": "measured"})
        except BrokerUnavailable:
            provider_context_failure = True
            failure_owner = "host"
        except Exception as exc:
            print(
                f"AgentDojo adapter failure: {type(exc).__name__}: {exc}",
                file=sys.stderr,
            )
            failure_owner = failure_owner or "adapter"
        if failure_owner is not None:
            break
    if provider_context_failure or failure_owner is not None or len(results) != len(selected_episodes):
        _write_once(
            output,
            {
                "schema": "coffee-chat-eval/agentdojo-security-v1",
                "sourceCommit": SOURCE_COMMIT,
                "benchmarkVersion": benchmark_version,
                "attack": attack_name,
                "defense": None,
                "profile": profile,
                "candidateCalls": broker.calls,
                "maxCandidateTurns": 45,
                "status": "unavailable" if provider_context_failure else "failed",
                "failureOwner": failure_owner or "artifact",
                "providerContextFailure": provider_context_failure,
                "publishedTableComparable": False,
                "episodes": results,
                "traceAttempt": trace_attempt,
            },
        )
        return
    benign = [item for item in results if item["kind"] == "benign"]
    controls = [item for item in results if item["kind"] == "injection-control"]
    attacked = [item for item in results if item["kind"] == "attacked"]
    _write_once(
        output,
        {
            "schema": "coffee-chat-eval/agentdojo-security-v1",
            "sourceCommit": SOURCE_COMMIT,
            "benchmarkVersion": benchmark_version,
            "attack": attack_name,
            "defense": None,
            "profile": profile,
            "candidateCalls": broker.calls,
            "maxCandidateTurns": 45,
            "status": "measured",
            "publishedTableComparable": False,
            "benignUtility": _metric(sum(1 for item in benign if item["utility"]), len(benign)),
            "utilityUnderAttack": _metric(sum(1 for item in attacked if item["utility"]), len(attacked)),
            "targetedASR": _metric(sum(1 for item in attacked if item["attackSuccess"]), len(attacked)),
            "injectionTaskSolvability": _metric(sum(1 for item in controls if item["utility"]), len(controls)),
            "episodes": results,
            "traceAttempt": trace_attempt,
        },
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache-root", type=Path, required=False)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--evidence-root", type=Path, required=True)
    parser.add_argument("--candidate-runtime", type=Path, required=False)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--profile", choices=["fixture", "smoke", "pilot", "score"], default="score")
    parser.add_argument("--attack", default=ATTACK_NAME)
    parser.add_argument("--defense", default="None")
    parser.add_argument("--benchmark-version", default=BENCHMARK_VERSION)
    args = parser.parse_args()
    for label, value in vars(args).items():
        if isinstance(value, Path) and value is not None and not value.is_absolute():
            raise SystemExit(f"{label} must be absolute")
    defense = None if args.defense == "None" else args.defense
    run(args.source_root, args.evidence_root, args.output, args.candidate_runtime, args.profile, args.attack, defense, args.benchmark_version)


if __name__ == "__main__":
    main()
