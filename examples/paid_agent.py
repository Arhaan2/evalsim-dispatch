"""A standard-library agent for the DISPATCH paid-survey JSON Lines benchmark."""

import json
import sys


def decide(o, calls):
    if o["phase"] == "survey":
        return "buy" if o["slots"] == 1 else "skip"
    if not any(call["id"] == "accept" for call in calls):
        return "pass"
    if len(o["forecast"]) < o["slots"]:
        return "accept"
    future = o["forecast"]
    chance = o["quote"]["highChance"] if o["reading"] is None else (o["reading"] + 1) / 8
    target = sum(q["low"] + chance * (q["high"] - q["low"]) for q in future) / len(future)
    return "accept" if o["offer"]["net"] >= target else "pass"


if __name__ == "__main__":
    for line in sys.stdin:
        request = json.loads(line)
        print(json.dumps({"action": decide(request["observation"], request["calls"])}), flush=True)
