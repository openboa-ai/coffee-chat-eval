import json
import math
import os
from pathlib import Path
import stat
from typing import Any

MAX_ARTIFACT_BYTES = 64 * 1024
MAX_JSON_DEPTH = 16
MAX_JSON_ENTRIES = 2048
MAX_JSON_STRING_BYTES = 64 * 1024


def _reject_constant(value: str) -> None:
    raise ValueError(f"non-finite JSON number is not allowed: {value}")


def _validate_json_budget(value: Any) -> None:
    stack: list[tuple[Any, int]] = [(value, 0)]
    entries = 0
    string_bytes = 0

    while stack:
        current, depth = stack.pop()
        entries += 1
        if entries > MAX_JSON_ENTRIES:
            raise ValueError("JSON entry limit exceeded")
        if depth > MAX_JSON_DEPTH:
            raise ValueError("JSON depth limit exceeded")

        if isinstance(current, dict):
            if len(current) > MAX_JSON_ENTRIES:
                raise ValueError("JSON object entry limit exceeded")
            for key, item in current.items():
                string_bytes += len(key.encode("utf-8"))
                stack.append((item, depth + 1))
        elif isinstance(current, list):
            if len(current) > MAX_JSON_ENTRIES:
                raise ValueError("JSON array entry limit exceeded")
            stack.extend((item, depth + 1) for item in current)
        elif isinstance(current, str):
            string_bytes += len(current.encode("utf-8"))
        elif isinstance(current, float) and not math.isfinite(current):
            raise ValueError("non-finite JSON number is not allowed")
        elif current is not None and not isinstance(
            current, (bool, int, float)
        ):
            raise ValueError("unsupported JSON value")

        if string_bytes > MAX_JSON_STRING_BYTES:
            raise ValueError("JSON string byte limit exceeded")


def _identity(value: os.stat_result) -> tuple[int, int, int, int, int, int]:
    return (
        value.st_dev,
        value.st_ino,
        value.st_mode,
        value.st_size,
        value.st_mtime_ns,
        value.st_ctime_ns,
    )


def read_bounded_json(
    path: Path,
    label: str,
    max_bytes: int = MAX_ARTIFACT_BYTES,
) -> Any:
    if not isinstance(max_bytes, int) or isinstance(max_bytes, bool) or max_bytes < 0:
        raise ValueError(f"{label} has an invalid byte limit")

    flags = (
        os.O_RDONLY
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
    )
    descriptor = os.open(path, flags)
    try:
        before = os.fstat(descriptor)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError(f"{label} must be a regular file")
        if before.st_size > max_bytes:
            raise ValueError(f"{label} exceeds the byte limit")

        chunks: list[bytes] = []
        bytes_read = 0
        while bytes_read <= max_bytes:
            chunk = os.read(descriptor, max_bytes + 1 - bytes_read)
            if not chunk:
                break
            chunks.append(chunk)
            bytes_read += len(chunk)

        after = os.fstat(descriptor)
        if bytes_read > max_bytes or after.st_size > max_bytes:
            raise ValueError(f"{label} exceeds the byte limit")
        if (
            _identity(before) != _identity(after)
            or bytes_read != after.st_size
        ):
            raise ValueError(f"{label} changed while being read")

        text = b"".join(chunks).decode("utf-8", errors="strict")
        value = json.loads(text, parse_constant=_reject_constant)
        _validate_json_budget(value)
        return value
    finally:
        os.close(descriptor)
