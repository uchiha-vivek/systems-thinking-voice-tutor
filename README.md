# Systems Thinking Voice Tutor

An accessible voice tutor that explains Systems Thinking diagrams (causal loop diagrams,
stock-and-flow diagrams, behavior-over-time graphs) to blind and visually impaired students.

A student picks a diagram, presses **Start conversation** and talks: "Give me an overview",
"Walk me through the reinforcing loop", "If births go up, what happens to deaths?". An
ElevenLabs voice agent answers, but every variable, link, polarity and loop it mentions comes
from a graph engine on our server, never from the AI's own guess. A blind student can't check
the answer against the picture, so a wrong "+" or "−" would teach the wrong thing.

```
Browser (web/, Next.js on :3000)  ──/api/*──▶  FastAPI (backend/, :8000)  ◀──/tools/*──  ElevenLabs agent
          └──────── voice (ElevenLabs React SDK) ────────────────────────────────────────▶
```

| Part | Stack |
|---|---|
| Voice (speech-to-text, LLM, text-to-speech, interruptions) | ElevenLabs Agents |
| Backend: diagram engine + agent tools | Python, FastAPI, NetworkX, RapidFuzz |
| Student page | Next.js, React, Tailwind CSS, `@elevenlabs/react` |
| Diagrams | JSON files in `backend/models/` |

## Prerequisites

| Need | Check / get it |
|---|---|
| Git | `git --version` |
| Python 3.11+ | `python3 --version` |
| Node.js 20+ and npm | `node --version` |
| An ElevenLabs account and API key | elevenlabs.io → Profile → API Keys. The key needs access to Agents (Conversational AI). |
| ngrok, so ElevenLabs can reach your local server | `brew install ngrok`, then sign in once with `ngrok config add-authtoken <token>` |
| A browser with a microphone | Chrome, Edge, Safari or Firefox |

## 1. Clone

```bash
git clone https://github.com/uchiha-vivek/systems-thinking-voice-tutor.git
```

```bash
cd systems-thinking-voice-tutor
```

## 2. Install

Backend (Python):

```bash
python3 -m venv .venv
```

```bash
.venv/bin/pip install -r requirements.txt
```

Frontend (Next.js):

```bash
cd web && npm install && cd ..
```

## 3. Configure

### Create the agent in ElevenLabs

In the ElevenLabs dashboard, go to **Agents → New agent → Blank** and pick a clear, calm voice.
Copy the agent id (it starts with `agent_`). You don't need to write the prompt or add tools by
hand: the setup script in step 5 does that.

### Backend secrets: `.env` in the project root

```bash
cp .env.example .env
```

Fill in:

| Variable | Value |
|---|---|
| `ELEVENLABS_API_KEY` | Your ElevenLabs API key |
| `ELEVENLABS_AGENT_ID` | The agent id you just copied |
| `PUBLIC_BASE_URL` | Leave empty for now; you fill it in step 4 |
| `TOOL_SECRET` | Any long random string. Generate one with the command below |

```bash
python3 -c "import secrets;print(secrets.token_urlsafe(32))"
```

### Frontend: `web/.env.local`

```bash
echo "BACKEND_URL=http://localhost:8000" > web/.env.local
```

`.env` and `web/.env.local` are git-ignored. Never commit them.

## 4. Run

Open three terminals in the project folder.

**Terminal 1: backend**

```bash
cd backend && ../.venv/bin/uvicorn server:app --port 8000
```

**Terminal 2: public tunnel**

```bash
ngrok http 8000
```

Copy the `https://…` forwarding URL ngrok prints into `.env` as `PUBLIC_BASE_URL`, with no
trailing slash. Check it works:

```bash
curl -s https://YOUR-NGROK-URL/health
```

You should see `{"ok":true,"models":["deer-population","water-supply"]}`.

**Terminal 3: student page**

```bash
cd web && npm run dev
```

## 5. Connect the agent to the backend

With the backend and tunnel running, from the project root:

```bash
.venv/bin/python scripts/setup_agent.py
```

This sets the agent's prompt, first message, dynamic variables and LLM, creates the six
webhook tools pointing at your tunnel, and attaches them to the agent. It only updates tools
already attached to this agent, so it's safe in a workspace shared with other projects.

**Re-run it whenever the ngrok URL or `TOOL_SECRET` changes.** Free ngrok URLs change each
time ngrok restarts.

## 6. Use it

Open **http://localhost:3000**, choose a model, press **Start conversation**, allow the
microphone and speak. You can also type a question. Press **Escape** to end. The Appearance
switch at the bottom picks System, Light or Dark.

Try with the **Deer Population** model:

| Say | You should hear |
|---|---|
| "Give me an overview" | Two loops: one reinforcing (births), one balancing (deaths) |
| "Walk me through the reinforcing loop" | More deer → more births → more deer |
| "If births go up, what happens to deaths?" | Deaths go up, through deer population |
| "Where is the balancing loop on the diagram?" | On the right, marked B |
| "What affects wolves?" | No such variable, then the real ones |

Each factual answer should show a `POST /tools/...` line in the backend terminal. If it
doesn't, the agent is answering from its own knowledge; see Troubleshooting.

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest -q tests
```

```bash
cd web && npm test
```

Backend (54): the engine, every tool over HTTP (secret check, unknown model, the expected
answers for both diagrams) and the tool payloads `setup_agent.py` sends. Frontend (19): the
page with the ElevenLabs SDK mocked (start/stop, dynamic variables, mic blocked, backend down,
transcript, typed questions, Escape, screen-reader opt-in, tab order), the theme switcher and
the `/api` proxy config. None of the tests call ElevenLabs.

## Project layout

```
backend/
  engine.py            graph engine: loops, R/B type, causes and effects, paths
  server.py            FastAPI: the six /tools/* endpoints + /api/models, /api/config, /health
  models/*.json        one file per diagram; the filename is the model_id
  tests/
scripts/
  setup_agent.py       creates/updates the agent's tools and settings
  system_prompt.txt    the agent's prompt
  first_message.txt    the agent's greeting
web/                   Next.js + Tailwind student page
  app/tutor.tsx        the page
  app/theme-switcher.tsx
  __tests__/
```

To add a diagram, write a new JSON file in `backend/models/` in the same format as the two
existing ones and restart the backend.

## Troubleshooting

| Problem | Likely cause / fix |
|---|---|
| Page says "Could not reach the tutor server" | Backend isn't running on port 8000 |
| Agent answers without calling tools | Run `setup_agent.py` again; check the backend terminal for `/tools/` calls |
| Tool calls get 401 | `TOOL_SECRET` in `.env` changed since the last `setup_agent.py` run. Run it again |
| Tool calls time out | Tunnel is down or its URL changed. Check `curl $PUBLIC_BASE_URL/health`, update `.env`, re-run `setup_agent.py` |
| "Unknown model" errors | The page didn't pass the model; reload and pick a model before starting |
| No microphone | The browser blocked it. Use `localhost` or HTTPS and allow mic access |
| `setup_agent.py` returns 422 | ElevenLabs changed a field name. Check their Agents API docs |

## Lock down later

The agent is **public**: anyone with its id can start a conversation, and usage is billed to
your ElevenLabs workspace. Before sharing beyond testing, make the agent private and have the
backend issue signed conversation URLs.
