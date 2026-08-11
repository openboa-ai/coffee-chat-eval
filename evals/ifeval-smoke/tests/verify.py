import json
from pathlib import Path

artifact = Path("/app/ifeval-result.json")
reference = json.loads(Path("/tests/reference.json").read_text())
reward = 0
try:
    value = json.loads(artifact.read_text())
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
except (OSError, json.JSONDecodeError):
    pass

Path("/logs/verifier/reward.json").write_text(json.dumps({"reward": reward}))
