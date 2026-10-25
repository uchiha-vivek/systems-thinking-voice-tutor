# Systems Thinking Voice Tutor

An accessible voice tutor that explains Systems Thinking diagrams (causal loop diagrams,
stock-and-flow diagrams, behavior-over-time graphs) to blind and visually impaired students.

A student uploads their model (a Stella `.stmx` file), presses **Start conversation** and talks: "Give me an overview",
"Walk me through the reinforcing loop", "If births go up, what happens to deaths?". An
ElevenLabs voice agent answers, but every variable, link, polarity and loop it mentions comes
from a graph engine on our server, never from the AI's own guess. A blind student can't check
the answer against the picture, so a wrong "+" or "−" would teach the wrong thing.

```
Student's browser
  ├─ reads the uploaded Stella file, runs the graph engine and answers the agent's tool calls
  └─ voice ◀──▶ ElevenLabs agent (speech, language model, tools requested by name)
```

Everything runs in the student's browser except the voice agent. The model file is read in the
page and never uploaded to a server. The agent asks the page for facts through ElevenLabs *client
tools* (`get_overview`, `get_loop`, …), so there is no backend to host, no tunnel and no webhook
secret. The same Next.js app deploys to Vercel as is. The one server route, `/api/feedback`,
only saves the optional after-session rating (see "Feedback sheet").

| Part | Stack |
|---|---|
| Voice (speech-to-text, LLM, text-to-speech, interruptions) | ElevenLabs Agents |
| Stella reader, equation analysis, graph engine | TypeScript in `web/lib/`, RapidFuzz (`rapidfuzz-js`) |
| Student page | Next.js, React, Tailwind CSS, `@elevenlabs/react` |
| Built-in example diagrams | JSON files in `web/lib/models/` |
| Hosting | Vercel |

## How a conversation goes

1. The student opens the page and either uploads a `.stmx` file or starts talking right away.
   With no model loaded, the agent asks them to use the upload button.
2. The page reads the file. Variables, stocks, flows and links come straight from the file. The
   direction of each link (+ or −) is the author's own mark when the connector has one, otherwise
   it is worked out from the equation, and it is reported as **unclear** when the equation can't
   settle it. The agent is told never to pick a direction for an unclear link.
3. The agent says what was loaded and asks "would you like me to describe it?" Then it answers
   questions by calling the tools: overview, what affects X, walk through a loop, if X goes up
   what happens to Y, what the graphs plot, where things are drawn.

Pictures and PDFs are not supported yet; only Stella files.

## Prerequisites

| Need | Check / get it |
|---|---|
| Git | `git --version` |
| Node.js 22.18+ and npm | `node --version` |
| An ElevenLabs account and API key | elevenlabs.io → Profile → API Keys. The key needs access to Agents (Conversational AI). |
| A Vercel account (to deploy) | vercel.com |
| A browser with a microphone | Chrome, Edge, Safari or Firefox |

## 1. Clone and install

```bash
git clone https://github.com/uchiha-vivek/systems-thinking-voice-tutor.git
```

```bash
cd systems-thinking-voice-tutor/web && npm install
```

## 2. Configure

### Create the agent in ElevenLabs

In the ElevenLabs dashboard, go to **Agents → New agent → Blank** and pick a clear, calm voice.
Copy the agent id (it starts with `agent_`). You don't need to write the prompt or add tools by
hand: `npm run setup-agent` does that.

### Environment variables: `web/.env.local`

```bash
cp .env.example .env.local
```

| Variable | Value |
|---|---|
| `ELEVENLABS_AGENT_ID` | The agent id you just copied |
| `ELEVENLABS_API_KEY` | Your ElevenLabs API key. Only `npm run setup-agent` reads it, so it is never needed on Vercel |

`.env.local` is git-ignored. Never commit it.

## 3. Connect the agent

```bash
npm run setup-agent
```

This sets the agent's prompt, greeting, dynamic variables and LLM, creates the six client tools
and attaches them to the agent. It only updates tools already attached to this agent, so it is
safe in a workspace shared with other projects. Run it again whenever
`scripts/system_prompt.txt`, `scripts/first_message.txt` or `lib/tool-specs.ts` changes.

## 4. Run locally

```bash
npm run dev
```

Open **http://localhost:3000**, upload a Stella file (or press an example), press **Start
conversation**, allow the microphone and speak. You can also type a question. Press **Escape**
to end. The sun or moon button at the top right switches between light and dark mode.

Try with the **Deer Population** example:

| Say | You should hear |
|---|---|
| "Give me an overview" | Two loops: one reinforcing (births), one balancing (deaths) |
| "Walk me through the reinforcing loop" | More deer → more births → more deer |
| "If births go up, what happens to deaths?" | Deaths go up, through deer population |
| "Where is the balancing loop on the diagram?" | On the right, marked B |
| "What affects wolves?" | No such variable, then the real ones |

## 5. Deploy to Vercel

1. Push the repo to GitHub and import it in Vercel.
2. Set **Root Directory** to `web`.
3. Add `ELEVENLABS_AGENT_ID` under Project Settings → Environment Variables.
4. Deploy. Nothing else is needed: the agent talks to the page in the browser, not to your server.

## Tests

```bash
cd web && npm test
```

The tests cover the equation reader (which way each input pushes a result), the Stella reader,
the graph engine, every tool, the page with the ElevenLabs SDK mocked (upload, start, mid-call
upload, tool answers, keyboard order), and the setup script's tool definitions. None of them
call ElevenLabs.

`__tests__/engine-parity.test.ts` compares the engine with answers recorded from the original
Python/NetworkX engine on the built-in diagrams.

## Project layout

```
web/
  app/
    tutor.tsx            the student page: upload, voice, transcript, client tools
    theme-switcher.tsx
    api/config/          serves the agent id
  lib/
    stella.ts            reads a .stmx file: variables, stocks and flows, links, graphs
    equation.ts          parses Stella equations and works out the direction of each input
    engine.ts            graph engine: loops, R/B type, causes and effects, paths
    tools.ts             the agent's tools, answering from the loaded model
    tool-specs.ts        tool names, descriptions and parameters (shared with setup-agent)
    models/*.json        built-in example diagrams, registered in models/index.ts
  scripts/
    setup-agent.ts       creates/updates the agent's tools and settings
    system_prompt.txt    the agent's prompt: behaviour only, no model data
    first_message.txt    the greeting: {{opening}}, filled in by the page
  __tests__/
```

To add a built-in example, write a JSON file in `web/lib/models/` in the same format as the two
existing ones, then import it and add it to the list in `web/lib/models/index.ts`.

## Troubleshooting

| Problem | Likely cause / fix |
|---|---|
| "Could not read as XML" / "not a Stella model" | The file isn't a Stella `.stmx`. Save from Stella Architect with File → Save |
| "Models that use arrays are not supported yet" | The model uses subscripted (array) variables |
| The overview warns that some link directions are unclear | The equation doesn't settle the direction (for example a switch between two formulas). The agent says so instead of guessing |
| Agent answers without calling tools | Run `npm run setup-agent` again and check the transcript for tool calls |
| The agent says no model is loaded | Upload a file or press an example; the page tells the agent right away |
| No microphone | The browser blocked it. Use `localhost` or HTTPS and allow mic access |
| `setup-agent` returns 422 | ElevenLabs changed a field name. Check their Agents API docs |
| `setup-agent` fails with a syntax error | Node is older than 22.18; it can't run TypeScript directly. Upgrade Node |

## Lock down later

The agent is **public**: anyone with its id can start a conversation, and usage is billed to
your ElevenLabs workspace. Before sharing beyond testing, make the agent private and have the
app issue signed conversation URLs.

## Feedback sheet (optional)

After each conversation the page asks "Was this helpful?" and for a 1–5 rating. Answers go to
`/api/feedback`, which adds a row to a Google Sheet. Until this is set up, the form says the
feedback couldn't be sent; nothing else is affected. Only the answers, the model title, the
number of transcript lines and the ElevenLabs conversation id are saved, never the transcript.

1. Create a Google Sheet. Open **Extensions → Apps Script**, replace the code with
   `web/scripts/feedback-sheet.gs`, and save.
2. In Apps Script, open **Project Settings → Script properties** and add `SECRET` with a long
   random value (for example from `openssl rand -hex 24`).
3. **Deploy → New deployment → Web app**. Execute as **Me**, access **Anyone**. Copy the web
   app URL (it ends in `/exec`).
4. Add to `web/.env.local`, and on Vercel under Environment Variables:

| Variable | Value |
|---|---|
| `FEEDBACK_SHEET_URL` | The web app URL from step 3 |
| `FEEDBACK_SECRET` | The same value as the `SECRET` property |

The URL and secret stay on the server; the page only talks to `/api/feedback`.

## Privacy

The model file is read in the browser and never uploaded. The conversation itself (voice and
transcript) is processed by ElevenLabs. `npm run setup-agent` turns off audio recording and sets
transcripts to be deleted after 30 days (`PRIVACY_SETTINGS` in `web/scripts/setup-agent.ts`);
the page's privacy notice says the same, so change both together.

## License

MIT. See [LICENSE](LICENSE). The code is free to use and change. Running the voice tutor uses an
ElevenLabs account, billed per minute to whoever owns the agent.
