"""A standard-library agent for the DISPATCH Reserve JSON Lines interface."""

import json
import sys


def decide(observation, calls):
    """Match the JavaScript starter's average-forecast booking rule."""
    if not any(call["id"] == "accept" for call in calls):
        return "pass"
    forecast = observation["forecast"]
    target = sum(entry["mean"] for entry in forecast) / max(1, len(forecast))
    return "accept" if observation["offer"]["net"] >= target else "pass"


if __name__ == "__main__":
    for line in sys.stdin:
        request = json.loads(line)
        print(json.dumps({"action": decide(request["observation"], request["calls"])}), flush=True)
