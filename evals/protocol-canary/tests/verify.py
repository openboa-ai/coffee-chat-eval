import json
from pathlib import Path

artifact = Path("/app/protocol-canary.json")
reward = 0
try:
    value = json.loads(artifact.read_text())
    if value == {
        "protocol": "coffee-chat-plugin",
        "entrypoint": "coffee-chat",
        "status": "invoked",
    }:
        reward = 1
except (OSError, json.JSONDecodeError):
    pass

Path("/logs/verifier/reward.json").write_text(json.dumps({"reward": reward}))
