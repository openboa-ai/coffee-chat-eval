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
RESPONSES_REPLAY_STATE = "coffee_chat_eval.responses_replay_v1"
SMOKE_USER_TASKS = {"workspace": ("user_task_0",)}
SMOKE_INJECTION_TASKS = {"workspace": ("injection_task_0",)}
PILOT_USER_TASKS = {"workspace": ("user_task_0", "user_task_24", "user_task_26", "user_task_13")}
PILOT_INJECTION_TASKS = {"workspace": ("injection_task_0", "injection_task_1", "injection_task_4", "injection_task_10")}
MAX_ITERS = 15


def _sequential_task_ids(kind: str, first: int, count: int) -> tuple[str, ...]:
    return tuple(f"{kind}_task_{index}" for index in range(first, first + count))


# Exact task-ID sets admitted from AgentDojo v1.2.2, in Eval-stable order.
SCORE_USER_TASKS = {
    "workspace": _sequential_task_ids("user", 0, 40),
    "travel": _sequential_task_ids("user", 0, 20),
    "banking": _sequential_task_ids("user", 0, 16),
    "slack": _sequential_task_ids("user", 0, 21),
}
SCORE_INJECTION_TASKS = {
    "workspace": _sequential_task_ids("injection", 0, 14),
    "travel": _sequential_task_ids("injection", 0, 7),
    "banking": _sequential_task_ids("injection", 0, 9),
    "slack": _sequential_task_ids("injection", 1, 5),
}


class BrokerUnavailable(RuntimeError):
    pass


class AdapterInputInvalid(RuntimeError):
    pass


class CandidateOutputInvalid(RuntimeError):
    pass


def _json_safe(value: Any) -> Any:
    if hasattr(value, "model_dump"):
        return _json_safe(value.model_dump())
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    return value


def _message_text(message: dict[str, Any]) -> str:
    content = message.get("content")
    if content is None:
        return ""
    if not isinstance(content, list | tuple):
        raise AdapterInputInvalid("AgentDojo message content is not a native content-block list")
    text: list[str] = []
    for block in content:
        normalized = _json_safe(block)
        if (
            not isinstance(normalized, dict)
            or normalized.get("type") != "text"
            or not isinstance(normalized.get("content"), str)
        ):
            raise AdapterInputInvalid("AgentDojo message contains a non-text content block")
        text.append(normalized["content"])
    return "\n".join(text)


def _function_call_value(call: Any, field: str) -> Any:
    if isinstance(call, dict):
        return call.get(field)
    return getattr(call, field, None)


def _responses_function_call(call: Any) -> tuple[str, dict[str, Any]]:
    call_id = _function_call_value(call, "id")
    name = _function_call_value(call, "function")
    arguments = _json_safe(_function_call_value(call, "args"))
    if not isinstance(call_id, str) or not call_id:
        raise AdapterInputInvalid("AgentDojo function call ID is required for Responses")
    if not isinstance(name, str) or not name or not isinstance(arguments, dict):
        raise AdapterInputInvalid("AgentDojo function call is invalid")
    try:
        arguments_json = json.dumps(
            arguments,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
    except (TypeError, ValueError) as exc:
        raise AdapterInputInvalid("AgentDojo function arguments are not JSON-compatible") from exc
    return call_id, {
        "type": "function_call",
        "call_id": call_id,
        "name": name,
        "arguments": arguments_json,
    }


def _replay_groups_by_calls(
    replay_groups: Sequence[dict[str, Any]] | None,
) -> dict[tuple[str, ...], list[dict[str, Any]]]:
    indexed: dict[tuple[str, ...], list[dict[str, Any]]] = {}
    for group in replay_groups or ():
        if not isinstance(group, dict):
            raise AdapterInputInvalid("Responses replay context is invalid")
        raw_call_ids = group.get("callIds")
        raw_items = group.get("items")
        if (
            not isinstance(raw_call_ids, list)
            or not raw_call_ids
            or any(not isinstance(call_id, str) or not call_id for call_id in raw_call_ids)
            or not isinstance(raw_items, list)
            or any(not isinstance(item, dict) for item in raw_items)
        ):
            raise AdapterInputInvalid("Responses replay context is invalid")
        call_ids = tuple(raw_call_ids)
        if call_ids in indexed:
            raise AdapterInputInvalid("Responses replay function calls are duplicated")
        replay_call_ids = tuple(
            item.get("call_id") for item in raw_items if item.get("type") == "function_call"
        )
        if replay_call_ids != call_ids:
            raise AdapterInputInvalid("Responses replay function calls are invalid")
        indexed[call_ids] = raw_items
    return indexed


def _replay_text(items: Sequence[dict[str, Any]]) -> str | None:
    text: list[str] = []
    saw_message = False
    for item in items:
        if item.get("type") != "message":
            continue
        saw_message = True
        content = item.get("content")
        if not isinstance(content, list):
            raise AdapterInputInvalid("Responses replay assistant content is invalid")
        for part in content:
            if not isinstance(part, dict):
                raise AdapterInputInvalid("Responses replay assistant content is invalid")
            if part.get("type") == "output_text":
                value = part.get("text")
            elif part.get("type") == "refusal":
                value = part.get("refusal")
            else:
                raise AdapterInputInvalid("Responses replay assistant content is invalid")
            if not isinstance(value, str):
                raise AdapterInputInvalid("Responses replay assistant content is invalid")
            text.append(value)
    return "\n".join(text) if saw_message else None


def _messages_to_responses_input(
    messages: Sequence[dict[str, Any]],
    replay_groups: Sequence[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Translate pinned AgentDojo ChatMessages to stateless Responses input items.

    AgentDojo's ``TextContentBlock`` uses ``content`` rather than Responses'
    ``text`` field, and its tool results use a Chat Completions-style ``tool``
    role.  Forwarding those dictionaries directly therefore creates an invalid
    Responses request.  This translation retains only candidate-visible text,
    declared function calls and their outputs; evaluator state is never an
    input to this function.
    """

    items: list[dict[str, Any]] = []
    pending_call_ids: set[str] = set()
    seen_call_ids: set[str] = set()
    replay_by_calls = _replay_groups_by_calls(replay_groups)
    used_replay_groups: set[tuple[str, ...]] = set()
    for message in messages:
        if not isinstance(message, dict):
            raise AdapterInputInvalid("AgentDojo message is not an object")
        role = message.get("role")
        if role in {"system", "user"}:
            items.append({"role": role, "content": _message_text(message)})
            continue
        if role == "assistant":
            content = message.get("content")
            text = _message_text(message)
            raw_calls = message.get("tool_calls")
            if raw_calls is None:
                if content is not None:
                    items.append({"role": "assistant", "content": text})
                continue
            if not isinstance(raw_calls, list | tuple):
                raise AdapterInputInvalid("AgentDojo assistant tool calls are invalid")
            translated_calls = [_responses_function_call(raw_call) for raw_call in raw_calls]
            replay_key = tuple(call_id for call_id, _item in translated_calls)
            replay_items = replay_by_calls.get(replay_key)
            if replay_items is not None:
                replay_calls = [item for item in replay_items if item.get("type") == "function_call"]
                if any(
                    replay_call.get("name") != _function_call_value(raw_call, "function")
                    for replay_call, raw_call in zip(replay_calls, raw_calls, strict=True)
                ):
                    raise AdapterInputInvalid("Responses replay function call drifted")
                replay_text = _replay_text(replay_items)
                if replay_text is not None and replay_text != text:
                    raise AdapterInputInvalid("Responses replay assistant content drifted")
                if replay_text is None and content is not None:
                    items.append({"role": "assistant", "content": text})
                items.extend(replay_items)
                used_replay_groups.add(replay_key)
            elif content is not None:
                items.append({"role": "assistant", "content": text})
            for call_id, item in translated_calls:
                if call_id in seen_call_ids:
                    raise AdapterInputInvalid("AgentDojo function call ID is duplicated")
                seen_call_ids.add(call_id)
                pending_call_ids.add(call_id)
                if replay_items is None:
                    items.append(item)
            continue
        if role == "tool":
            call_id = message.get("tool_call_id")
            if not isinstance(call_id, str) or not call_id or call_id not in pending_call_ids:
                raise AdapterInputInvalid("AgentDojo tool result does not match a prior function call")
            raw_call = message.get("tool_call")
            raw_call_id = _function_call_value(raw_call, "id")
            if raw_call_id != call_id:
                raise AdapterInputInvalid("AgentDojo tool result function call ID drifted")
            error = message.get("error")
            if error is not None and not isinstance(error, str):
                raise AdapterInputInvalid("AgentDojo tool error is invalid")
            output = error or _message_text(message)
            items.append(
                {
                    "type": "function_call_output",
                    "call_id": call_id,
                    "output": output,
                }
            )
            pending_call_ids.remove(call_id)
            continue
        raise AdapterInputInvalid("AgentDojo message role is unsupported by Responses")
    if pending_call_ids:
        raise AdapterInputInvalid("AgentDojo function call is missing its tool result")
    if used_replay_groups != set(replay_by_calls):
        raise AdapterInputInvalid("Responses replay context does not match AgentDojo messages")
    return items


def _tool_schema(runtime: Any) -> list[dict[str, Any]]:
    functions = getattr(runtime, "functions", None)
    if not isinstance(functions, dict):
        raise AdapterInputInvalid("AgentDojo runtime functions are invalid")
    tools: list[dict[str, Any]] = []
    for function in functions.values():
        name = getattr(function, "name", None)
        description = getattr(function, "description", None)
        parameters = getattr(function, "parameters", None)
        schema_factory = getattr(parameters, "model_json_schema", None)
        if not isinstance(name, str) or not name or not isinstance(description, str) or not callable(schema_factory):
            raise AdapterInputInvalid("AgentDojo function schema is invalid")
        schema = _json_safe(schema_factory())
        if not isinstance(schema, dict):
            raise AdapterInputInvalid("AgentDojo function parameters are invalid")
        tools.append(
            {
                "type": "function",
                "name": name,
                "description": description,
                "parameters": schema,
                # AgentDojo's Pydantic schemas were not authored for OpenAI's
                # strict-mode subset.  Responses requires the field on a
                # function tool, so preserve the native schema under explicit
                # non-strict validation rather than rewriting it.
                "strict": False,
            }
        )
    return tools


def _response_assistant(value: Any) -> dict[str, Any]:
    """Convert one completed Responses result to an AgentDojo assistant message."""
    from agentdojo.functions_runtime import FunctionCall
    from agentdojo.types import text_content_block_from_string

    if not isinstance(value, dict):
        raise BrokerUnavailable("broker returned a non-object response")
    if value.get("error") is not None:
        raise BrokerUnavailable("broker returned a provider error")
    status = value.get("status")
    if status != "completed":
        raise BrokerUnavailable("broker response is not complete")
    output = value.get("output")
    if not isinstance(output, list):
        raise CandidateOutputInvalid("broker response output is missing")
    items = output
    content: list[dict[str, str]] = []
    calls: list[FunctionCall] = []
    call_ids: set[str] = set()
    for item in items:
        if not isinstance(item, dict):
            raise CandidateOutputInvalid("broker response output item is invalid")
        if item.get("type") == "function_call":
            call_id = item.get("call_id")
            name = item.get("name")
            raw_arguments = item.get("arguments")
            if not isinstance(call_id, str) or not call_id or call_id in call_ids:
                raise CandidateOutputInvalid("broker function call ID is invalid")
            if not isinstance(raw_arguments, str):
                raise CandidateOutputInvalid("broker function arguments are invalid")
            try:
                arguments = json.loads(raw_arguments)
            except json.JSONDecodeError as exc:
                raise CandidateOutputInvalid("broker function arguments are invalid") from exc
            if not isinstance(name, str) or not name or not isinstance(arguments, dict):
                raise CandidateOutputInvalid("broker function call is invalid")
            call_ids.add(call_id)
            calls.append(FunctionCall(function=name, args=arguments, id=call_id))
            continue
        if item.get("type") in {"reasoning", "computer_call", "file_search_call", "web_search_call"}:
            continue
        if item.get("type") != "message" or item.get("role") != "assistant":
            raise CandidateOutputInvalid("broker response output item is unsupported")
        parts = item.get("content")
        if not isinstance(parts, list):
            raise CandidateOutputInvalid("broker assistant content is invalid")
        for part in parts:
            if not isinstance(part, dict):
                raise CandidateOutputInvalid("broker assistant content item is invalid")
            if part.get("type") == "output_text" and isinstance(part.get("text"), str):
                content.append(text_content_block_from_string(part["text"]))
                continue
            if part.get("type") == "refusal" and isinstance(part.get("refusal"), str):
                content.append(text_content_block_from_string(part["refusal"]))
                continue
            raise CandidateOutputInvalid("broker assistant content item is unsupported")
    if not content and not calls:
        raise CandidateOutputInvalid("broker response contains no assistant output")
    return {"role": "assistant", "content": content or None, "tool_calls": calls or None}


def _response_replay_group(value: dict[str, Any]) -> dict[str, Any] | None:
    """Keep the minimum provider output needed for a stateless tool follow-up.

    GPT reasoning models require their reasoning item to accompany subsequent
    function outputs.  AgentDojo's native ChatMessage cannot represent that
    provider item, so it remains in ``extra_args`` and never enters native
    messages, trace logs, scorer state or public evidence.
    """

    output = value["output"]
    call_ids = [item["call_id"] for item in output if item.get("type") == "function_call"]
    if not call_ids:
        return None
    replay_items: list[dict[str, Any]] = []
    for item in output:
        item_type = item.get("type")
        if item_type == "reasoning":
            reasoning_id = item.get("id")
            summary = _json_safe(item.get("summary"))
            encrypted_content = item.get("encrypted_content")
            status = item.get("status")
            if (
                not isinstance(reasoning_id, str)
                or not reasoning_id
                or not isinstance(summary, list)
                or not isinstance(encrypted_content, str)
                or not encrypted_content
                or status not in {None, "completed"}
            ):
                raise CandidateOutputInvalid("broker reasoning replay item is invalid")
            replay_item: dict[str, Any] = {
                "type": "reasoning",
                "id": reasoning_id,
                "summary": summary,
                "encrypted_content": encrypted_content,
            }
            if status is not None:
                replay_item["status"] = status
            replay_items.append(replay_item)
            continue
        if item_type == "function_call":
            call_id = item.get("call_id")
            name = item.get("name")
            arguments = item.get("arguments")
            if not isinstance(call_id, str) or not isinstance(name, str) or not isinstance(arguments, str):
                raise CandidateOutputInvalid("broker function replay item is invalid")
            replay_item = {
                "type": "function_call",
                "call_id": call_id,
                "name": name,
                "arguments": arguments,
            }
            for optional in ("id", "status", "caller", "namespace"):
                if optional in item:
                    replay_item[optional] = _json_safe(item[optional])
            replay_items.append(replay_item)
            continue
        if item_type == "message":
            message_id = item.get("id")
            status = item.get("status")
            if not isinstance(message_id, str) or not message_id or status != "completed":
                raise CandidateOutputInvalid("broker assistant replay item is invalid")
            replay_items.append(
                {
                    "type": "message",
                    "id": message_id,
                    "status": status,
                    "role": "assistant",
                    "content": _json_safe(item["content"]),
                }
            )
            continue
        raise CandidateOutputInvalid("broker replay output item is unsupported")
    return {"callIds": call_ids, "items": replay_items}


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
        self.provider_context_failure = False
        self.adapter_input_failure = False
        self.candidate_output_failure = False
        self.provider_context_failure_count = 0
        self.adapter_input_failure_count = 0

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
            self.provider_context_failure = True
            self.provider_context_failure_count += 1
            raise BrokerUnavailable("candidate capability request cap exceeded")
        try:
            next_extra_args = dict(extra_args or {})
            replay_groups = next_extra_args.get(RESPONSES_REPLAY_STATE, [])
            if not isinstance(replay_groups, list):
                raise AdapterInputInvalid("Responses replay context is invalid")
            payload = {
                "model": self.model,
                "input": _messages_to_responses_input(messages, replay_groups),
                "include": ["reasoning.encrypted_content"],
                "store": False,
                "tools": _tool_schema(runtime),
            }
            request = urllib.request.Request(
                self.endpoint,
                data=json.dumps(payload, sort_keys=True).encode("utf-8"),
                headers={"authorization": f"Bearer {self.capability}", "content-type": "application/json"},
                method="POST",
            )
        except AdapterInputInvalid:
            self.adapter_input_failure = True
            self.adapter_input_failure_count += 1
            raise
        except Exception as exc:
            self.adapter_input_failure = True
            self.adapter_input_failure_count += 1
            raise AdapterInputInvalid("broker request assembly is invalid") from exc
        try:
            try:
                with urllib.request.urlopen(request, timeout=60) as response:
                    result = json.loads(response.read().decode("utf-8"))
            except (OSError, UnicodeDecodeError, urllib.error.URLError, json.JSONDecodeError) as exc:
                raise BrokerUnavailable("broker/context unavailable") from exc
            assistant = _response_assistant(result)
            replay_group = _response_replay_group(result)
            if replay_group is not None:
                next_extra_args[RESPONSES_REPLAY_STATE] = [*replay_groups, replay_group]
        except BrokerUnavailable:
            self.provider_context_failure = True
            self.provider_context_failure_count += 1
            raise
        except CandidateOutputInvalid:
            self.candidate_output_failure = True
            raise
        self.calls += 1
        return "", runtime, env, [*messages, assistant], next_extra_args


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


def _candidate_turn_ceiling(profile: str, episode_count: int) -> int:
    if profile == "fixture":
        return episode_count
    if profile in {"smoke", "pilot", "score"}:
        return episode_count * MAX_ITERS
    raise ValueError("unsupported AgentDojo profile")


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
    if profile == "score":
        user_tasks = SCORE_USER_TASKS
        injection_tasks = SCORE_INJECTION_TASKS
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


def _verify_score_task_ids(
    suite_name: str,
    actual_user_tasks: Sequence[str],
    actual_injection_tasks: Sequence[str],
) -> None:
    expected_users = SCORE_USER_TASKS[suite_name]
    expected_injections = SCORE_INJECTION_TASKS[suite_name]
    if len(actual_user_tasks) != len(expected_users) or set(actual_user_tasks) != set(expected_users):
        raise ValueError(f"AgentDojo score user-task IDs drifted for {suite_name}")
    if len(actual_injection_tasks) != len(expected_injections) or set(actual_injection_tasks) != set(expected_injections):
        raise ValueError(f"AgentDojo score injection-task IDs drifted for {suite_name}")


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
                "maxCandidateTurns": _candidate_turn_ceiling(profile, len(episodes)),
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
        for suite_name in SUITES:
            suite = get_suite(benchmark_version, suite_name)
            _verify_score_task_ids(
                suite_name,
                tuple(suite.user_tasks.keys()),
                tuple(suite.injection_tasks.keys()),
            )
    max_candidate_turns = _candidate_turn_ceiling(profile, len(selected_episodes))
    results: list[dict[str, Any]] = []
    trace_attempt = uuid4().hex
    direct_provider_context_failures = 0
    direct_adapter_input_failures = 0
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
        except CandidateOutputInvalid:
            failure_owner = "candidate"
        except AdapterInputInvalid:
            direct_adapter_input_failures += 1
            failure_owner = "adapter"
        except BrokerUnavailable:
            direct_provider_context_failures += 1
            failure_owner = "host"
        except Exception as exc:
            print(
                f"AgentDojo adapter failure: {type(exc).__name__}: {exc}",
                file=sys.stderr,
            )
            failure_owner = failure_owner or "adapter"
        if failure_owner is not None:
            break
    contaminated_provider_context = (
        broker.provider_context_failure_count > direct_provider_context_failures
    )
    contaminated_adapter_input = (
        broker.adapter_input_failure_count > direct_adapter_input_failures
    )
    direct_provider_context_failure = direct_provider_context_failures > 0
    direct_adapter_input_failure = direct_adapter_input_failures > 0
    if (
        contaminated_provider_context
        or contaminated_adapter_input
        or broker.candidate_output_failure
        or direct_provider_context_failure
        or direct_adapter_input_failure
        or failure_owner is not None
        or len(results) != len(selected_episodes)
    ):
        if contaminated_provider_context:
            status = "invalid"
            failure_owner = "host"
        elif contaminated_adapter_input:
            status = "invalid"
            failure_owner = "adapter"
        elif direct_provider_context_failure:
            status = "unavailable"
        elif direct_adapter_input_failure:
            status = "failed"
        elif broker.candidate_output_failure:
            status = "failed"
            failure_owner = "candidate"
        else:
            status = "failed"
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
                "maxCandidateTurns": max_candidate_turns,
                "status": status,
                "failureOwner": failure_owner or "artifact",
                "providerContextFailure": contaminated_provider_context or direct_provider_context_failure,
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
            "maxCandidateTurns": max_candidate_turns,
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
