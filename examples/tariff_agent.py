"""A price-sensitive, standard-library dispatcher for the tariff JSON Lines runner."""
import json
import sys
from paid_agent import decide as freight


def decide(observation, calls):
    if observation["phase"] == "survey":
        return "buy" if observation["slots"] == 1 and observation["priceCents"] <= 10 else "skip"
    return freight(observation, calls)


if __name__ == "__main__":
    for line in sys.stdin:
        request = json.loads(line)
        print(json.dumps({"action": decide(request["observation"], request["calls"])}), flush=True)
