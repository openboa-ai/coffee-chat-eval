import json
from pathlib import Path

from resources import read_bounded_json

artifact = Path("/app/protocol-canary.json")
reward = 0
try:
    value = read_bounded_json(artifact, "protocol canary artifact")
    if value == {
        "protocol": "coffee-chat-plugin",
        "entrypoint": "coffee-chat",
        "status": "invoked",
    }:
        reward = 1
except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
    # Invalid or unsafe candidate artifacts deterministically receive zero reward.
    pass

Path("/logs/verifier/reward.json").write_text(json.dumps({"reward": reward}))
