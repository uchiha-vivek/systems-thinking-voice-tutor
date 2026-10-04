# Systems Thinking Voice Tutor

A voice tutor that explains Systems Thinking diagrams to blind and visually impaired students.
The full spec is `ELEVENLABS_AGENT_BUILD.md`. This build uses a Next.js + Tailwind page in
`web/` instead of the spec's single `frontend/index.html`, so the FastAPI `/` route is unused.

```
Browser (web/, Next.js on :3000)  ──/api/*──▶  FastAPI (backend/, :8000)  ◀──/tools/*──  ElevenLabs agent
          └──────── voice (ElevenLabs React SDK) ────────────────────────────────────────▶
```

## First-time setup

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
cd web && npm install
```

`.env` (root) needs `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `PUBLIC_BASE_URL`, `TOOL_SECRET`.
`web/.env.local` needs `BACKEND_URL=http://localhost:8000`. Neither file is committed.

## Running it

Three terminals:

```bash
cd backend && ../.venv/bin/uvicorn server:app --port 8000
```

```bash
ngrok http 8000
```

```bash
cd web && npm run dev
```

Put the ngrok `https://…` URL in `.env` as `PUBLIC_BASE_URL`, then attach or refresh the tools:

```bash
.venv/bin/python scripts/setup_agent.py
```

Re-run that script whenever the tunnel URL or `TOOL_SECRET` changes. Open http://localhost:3000.

## Tests

```bash
cd backend && ../.venv/bin/python -m pytest -q tests
```

```bash
cd web && npm test
```

Backend (54): engine, every tool over HTTP (secret check, unknown model, the Checkpoint 4 answers),
and the tool payloads `setup_agent.py` sends. Frontend (14): the page with the ElevenLabs SDK
mocked (start/stop, dynamic variables, mic blocked, backend down, transcript, typed questions,
Escape, screen-reader opt-in, tab order) plus the `/api` proxy config. None of them call ElevenLabs.

## Lock down later

The agent is **public**: anyone with its id can start a conversation, and usage is billed to the
workspace. Before sharing beyond testing, make the agent private and have the backend issue
signed conversation URLs (see spec section 12).
