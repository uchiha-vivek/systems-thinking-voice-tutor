"""Create/update the tutor's 6 webhook tools and attach them to the ElevenLabs agent.

Usage: .venv/bin/python scripts/setup_agent.py

Tools are separate workspace objects referenced by id (prompt.tool_ids). The workspace is
shared with other projects, so this script never searches tools by name across the workspace:
it only updates tools already attached to THIS agent and creates whichever are missing.
Re-run it whenever PUBLIC_BASE_URL (the tunnel) or TOOL_SECRET changes.
"""
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).parent.parent
load_dotenv(ROOT / ".env")

API = "https://api.elevenlabs.io/v1/convai"
KEY = os.environ["ELEVENLABS_API_KEY"]
AGENT_ID = os.environ["ELEVENLABS_AGENT_ID"].strip()
BASE = os.environ["PUBLIC_BASE_URL"].strip().rstrip("/")
SECRET = os.environ["TOOL_SECRET"].strip()
LLM = os.environ.get("ELEVENLABS_LLM", "claude-sonnet-5-5")

if not BASE.startswith("https://"):
    raise SystemExit("PUBLIC_BASE_URL must be your https tunnel URL (e.g. https://xxxx.ngrok-free.dev).")

SYSTEM_PROMPT = (ROOT / "scripts" / "system_prompt.txt").read_text()
FIRST_MESSAGE = (ROOT / "scripts" / "first_message.txt").read_text().strip()


def s(desc):  # string parameter
    return {"type": "string", "description": desc}


MODEL_ID = s("The model_id from the system prompt.")
TOOLS = [
    ("get_overview", "Get the model's title, summary, loops, key variables and whether it was verified. Call this first and for any overview question.",
     {"model_id": MODEL_ID}),
    ("get_variable", "Get what affects a variable and what it affects, with the direction of each effect, and which loops it belongs to. Use for 'what connects to X', 'what affects X', 'what is X'.",
     {"model_id": MODEL_ID, "name": s("The variable name exactly as the student said it.")}),
    ("get_loop", "Get one feedback loop's steps in order, its type and its meaning. Use for 'walk me through' and 'explain the loop'.",
     {"model_id": MODEL_ID, "query": s("The loop as the student described it, e.g. 'reinforcing loop', 'B three point one', 'the births loop'.")}),
    ("find_path", "Find how one variable affects another through chains of links, and the overall effect. Use for 'if X goes up, what happens to Y'.",
     {"model_id": MODEL_ID, "from_name": s("The variable that changes first."), "to_name": s("The variable whose response the student is asking about.")}),
    ("get_behavior", "Get the behavior-over-time graphs described in words. Use for 'what happens over time' and 'what does the graph show'.",
     {"model_id": MODEL_ID}),
    ("get_layout", "Get where things are positioned on the diagram. Use ONLY when the student asks where something is or what it looks like.",
     {"model_id": MODEL_ID}),
]


def tool_config(name, description, props):
    return {
        "type": "webhook",
        "name": name,
        "description": description,
        "response_timeout_secs": 20,
        "api_schema": {
            "url": f"{BASE}/tools/{name}",
            "method": "POST",
            "request_headers": {"X-Tool-Secret": SECRET},
            "request_body_schema": {
                "type": "object",
                "description": f"Arguments for {name}.",
                "properties": props,
                "required": list(props),
            },
        },
    }


def main():
    with httpx.Client(base_url=API, headers={"xi-api-key": KEY}, timeout=30) as api:
        agent = api.get(f"/agents/{AGENT_ID}")
        agent.raise_for_status()
        attached = agent.json()["conversation_config"]["agent"]["prompt"].get("tool_ids") or []

        # Map name -> id for tools already attached to this agent only.
        ours_by_name, others = {}, []
        wanted = {t[0] for t in TOOLS}
        for tid in attached:
            r = api.get(f"/tools/{tid}")
            name = r.json().get("tool_config", {}).get("name") if r.is_success else None
            if name in wanted:
                ours_by_name[name] = tid
            else:
                others.append(tid)

        tool_ids = []
        for name, description, props in TOOLS:
            body = {"tool_config": tool_config(name, description, props)}
            if name in ours_by_name:
                r = api.patch(f"/tools/{ours_by_name[name]}", json=body)
                action = "updated"
            else:
                r = api.post("/tools", json=body)
                action = "created"
            if not r.is_success:
                raise SystemExit(f"{name}: {r.status_code} {r.text[:800]}")
            tool_ids.append(r.json()["id"])
            print(f"  {action} tool {name} -> {r.json()['id']}")

        patch = {
            "conversation_config": {
                "agent": {
                    "first_message": FIRST_MESSAGE,
                    "language": "en",
                    "dynamic_variables": {
                        "dynamic_variable_placeholders": {
                            "model_id": "deer-population",
                            "model_title": "Deer Population",
                        }
                    },
                    "prompt": {
                        "prompt": SYSTEM_PROMPT,
                        "llm": LLM,
                        "temperature": 0.3,
                        "tool_ids": others + tool_ids,
                    },
                }
            }
        }
        r = api.patch(f"/agents/{AGENT_ID}", json=patch)
        if not r.is_success:
            raise SystemExit(f"agent update: {r.status_code} {r.text[:800]}")
        got = r.json()["conversation_config"]["agent"]["prompt"]
        print(f"Updated agent {AGENT_ID}: llm={got['llm']}, {len(got.get('tool_ids') or [])} tools attached, "
              f"tools point at {BASE}/tools/*")


if __name__ == "__main__":
    main()
