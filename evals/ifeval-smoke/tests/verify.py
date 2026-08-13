import json
from pathlib import Path

from resources import read_bounded_json

artifact = Path("/app/ifeval-result.json")
reward = 0
try:
    reference = read_bounded_json(
        Path("/tests/reference.json"), "IFEval reference", 16 * 1024
    )
    value = read_bounded_json(artifact, "IFEval result artifact")
    response = value.get("response")
    if (
        value.get("benchmark") == "IFEval"
        and value.get("key") == reference["key"]
        and value.get("source_digest")
        == "sha256:d5ef5259a025140861c13b78b2be73479893b29d3cd1ed12cfda9446427d0396"
        and value.get("status") == "answered"
        and isinstance(response, str)
        and bool(response.strip())
        and "," not in response
    ):
        reward = 1
except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
    # Invalid or unsafe candidate artifacts deterministically receive zero reward.
    pass

Path("/logs/verifier/reward.json").write_text(json.dumps({"reward": reward}))
