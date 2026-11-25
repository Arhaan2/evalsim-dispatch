"""A JSON Lines dispatcher. Each request is one joint decision for both trucks."""
import json
import sys

for line in sys.stdin:
    request = json.loads(line)
    choice = max(request["calls"], key=lambda move: move["net"])
    print(json.dumps({"action": choice["id"]}), flush=True)
