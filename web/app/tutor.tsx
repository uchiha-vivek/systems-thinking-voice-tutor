"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

import { ModelGraph } from "@/lib/engine";
import { MODELS } from "@/lib/models";
import { parseStella, StellaError } from "@/lib/stella";
import { clientToolsFor } from "@/lib/tools";
import { ThemeSwitcher } from "./theme-switcher";

type Line = { who: string; text: string };

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const UPLOAD_TAG = "[Upload]"; // marks the page's own message to the agent, so it isn't shown as the student's words

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One plain sentence about what was loaded. Counts come from the engine, never from the AI. */
function summarize(graph: ModelGraph) {
  const ov = graph.overview() as { title: string; number_of_variables: number; number_of_loops: number };
  return `${ov.title}. It has ${plural(ov.number_of_variables, "variable")} and ${plural(ov.number_of_loops, "feedback loop")}.`;
}

function openingLine(graph: ModelGraph | null) {
  const hello = "Hi! I'm your Systems Thinking tutor.";
  return graph
    ? `${hello} I've loaded ${summarize(graph)} Would you like me to describe it?`
    : `${hello} To begin, upload your Stella model with the upload button on this page, and I'll walk you through it.`;
}

export function Tutor() {
  return (
    <ConversationProvider>
      <TutorPage />
    </ConversationProvider>
  );
}

function TutorPage() {
  const [loadNote, setLoadNote] = useState("");
  const [loadError, setLoadError] = useState("");
  const [agentId, setAgentId] = useState("");
  const [status, setStatus] = useState("Not connected.");
  const [lines, setLines] = useState<Line[]>([]);
  const [readAloud, setReadAloud] = useState(false);
  const [text, setText] = useState("");
  const textRef = useRef<HTMLInputElement>(null);

  // The agent's tools run here, against whatever model is loaded right now.
  const graphRef = useRef<ModelGraph | null>(null);
  const addLine = (who: string, text: string) => setLines((prev) => [...prev, { who, text }]);

  const conversation = useConversation({
    // eslint-disable-next-line react-hooks/refs -- the ref is read when the agent calls a tool, not while rendering
    clientTools: clientToolsFor(() => graphRef.current),
    onConnect: () => setStatus("Connected. Start speaking."),
    onDisconnect: () => setStatus("Conversation ended."),
    onMessage: ({ role, message }) => {
      if (role === "user" && message.startsWith(UPLOAD_TAG)) return;
      addLine(role === "user" ? "You" : "Tutor", message);
    },
    onError: (err) => setStatus(`Error: ${typeof err === "string" ? err : String(err)}`),
  });

  const running = conversation.status === "connected" || conversation.status === "connecting";

  useEffect(() => {
    (async () => {
      try {
        const config = await fetch("/api/config").then((r) => r.json());
        setAgentId(config.agent_id);
      } catch {
        setStatus("Could not reach the tutor server.");
      }
    })();
  }, []);

  /** Make `next` the model the tutor works from, and tell the agent if a conversation is already going. */
  function load(next: ModelGraph) {
    graphRef.current = next;
    setLoadError("");
    setLoadNote(`Loaded ${summarize(next)}`);
    if (conversation.status === "connected") {
      addLine("You (uploaded)", next.data.title);
      conversation.sendUserMessage(
        `${UPLOAD_TAG} The student just uploaded a model: ${summarize(next)} In one short sentence say what was loaded, then ask if they would like it described.`,
      );
    }
  }

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // so choosing the same file again still counts
    if (!file) return;
    try {
      if (/\.(png|jpe?g|gif|webp|pdf)$/i.test(file.name)) {
        throw new StellaError("Pictures and PDFs are not supported yet. Please upload the Stella file, which ends in .stmx.");
      }
      if (file.size > MAX_FILE_BYTES) throw new StellaError("That file is too large. Models up to 10 megabytes are supported.");
      load(new ModelGraph(parseStella(await file.text())));
    } catch (err) {
      setLoadNote("");
      setLoadError(err instanceof StellaError ? err.message : "That file could not be read as a Stella model.");
    }
  }

  async function start() {
    if (!agentId) {
      setStatus("The tutor is not configured yet.");
      return;
    }
    try {
      setStatus("Connecting…");
      await navigator.mediaDevices.getUserMedia({ audio: true });
      conversation.startSession({
        agentId,
        dynamicVariables: { opening: openingLine(graphRef.current) },
      });
    } catch (err) {
      setStatus(`Could not start: ${err instanceof Error ? err.message : String(err)}. Check microphone permission.`);
    }
  }

  function stop() {
    if (running) conversation.endSession();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") stop();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  function send(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (!value || conversation.status !== "connected") return;
    conversation.sendUserMessage(value);
    addLine("You (typed)", value);
    setText("");
    textRef.current?.focus();
  }

  const connected = conversation.status === "connected";
  const field =
    "w-full rounded-xl border border-field bg-surface px-4 py-3 text-fg transition-colors " +
    "hover:border-fg disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-field";
  const dot =
    conversation.status === "connected"
      ? "bg-ok"
      : conversation.status === "connecting"
        ? "bg-wait animate-pulse"
        : "bg-field";

  return (
    <main className="mx-auto max-w-2xl px-4 pb-20 pt-12 sm:pt-20">
      <header>
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
          Spoken diagram tutor
        </p>
        <h1 className="mt-3 font-serif text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
          Systems Thinking <em className="font-normal">Voice Tutor</em>
        </h1>
        <p className="mt-4 max-w-xl text-muted">
          Upload a Stella model, press Start conversation, and speak. You can interrupt the tutor at
          any time. Press Escape to end.
        </p>
      </header>

      <section aria-label="Conversation" className="mt-10 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
        <label htmlFor="upload" className="block text-sm font-semibold uppercase tracking-wider text-muted">
          Your model
        </label>
        <input
          id="upload"
          type="file"
          accept=".stmx,.xml,text/xml,application/xml"
          onChange={onUpload}
          aria-describedby="uploadHelp"
          className={`${field} mt-2 file:mr-4 file:rounded-lg file:border-0 file:bg-tint file:px-4 file:py-2 file:font-semibold file:text-fg`}
        />
        <p id="uploadHelp" className="mt-2 text-sm text-muted">
          Choose a Stella file that ends in .stmx. It is read in your browser and is not sent anywhere.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">Or try an example:</span>
          {[...MODELS].map(([id, m]) => (
            <button
              key={id}
              type="button"
              onClick={() => load(m)}
              className="rounded-lg border border-fg px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-fg hover:text-bg"
            >
              {m.data.title}
            </button>
          ))}
        </div>
        <p aria-live="polite" className="mt-3 min-h-6 font-serif text-lg">
          {loadNote}
        </p>
        {loadError && (
          <p role="alert" className="mt-1 font-semibold text-danger">
            {loadError}
          </p>
        )}

        <button
          type="button"
          aria-pressed={running}
          onClick={() => (running ? stop() : start())}
          className={`mt-5 flex w-full items-center justify-center gap-3 rounded-xl px-6 py-4 text-xl font-semibold tracking-wide shadow-sm transition hover:brightness-110 active:translate-y-px ${
            running ? "bg-danger text-on-danger" : "bg-accent text-on-accent"
          }`}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-6 w-6">
            {running ? (
              <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
            ) : (
              <path
                d="M12 15a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm6-3a6 6 0 0 1-12 0M12 18v3"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            )}
          </svg>
          {running ? "Stop conversation" : "Start conversation"}
        </button>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line pt-4">
          <div className="flex items-center gap-2.5">
            <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
            <p role="status">{status}</p>
          </div>
          <p aria-hidden="true" className="font-serif text-lg italic text-muted">
            {connected ? (conversation.isSpeaking ? "Tutor is speaking" : "Listening") : ""}
          </p>
        </div>
      </section>

      <form onSubmit={send} className="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
        <label htmlFor="textInput" className="block text-sm font-semibold uppercase tracking-wider text-muted">
          Or type a question
        </label>
        <div className="mt-2 flex flex-wrap gap-3 sm:flex-nowrap">
          <input
            id="textInput"
            ref={textRef}
            type="text"
            autoComplete="off"
            disabled={!connected}
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={field}
          />
          <button
            type="submit"
            disabled={!connected}
            className="w-full rounded-xl border border-fg px-6 py-3 font-semibold transition-colors hover:bg-fg hover:text-bg disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent disabled:hover:text-fg sm:w-auto"
          >
            Send
          </button>
        </div>
      </form>

      <section className="mt-12">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2 border-b border-line pb-3">
          <h2 id="transcriptHeading" className="font-serif text-3xl font-medium">
            Transcript
          </h2>
          <label className="flex cursor-pointer items-center gap-2.5 text-base text-muted">
            <input
              type="checkbox"
              checked={readAloud}
              onChange={(e) => setReadAloud(e.target.checked)}
              className="h-5 w-5 accent-[var(--accent)]"
            />
            Let my screen reader read new transcript lines
          </label>
        </div>
        <ol
          aria-labelledby="transcriptHeading"
          aria-live={readAloud ? "polite" : "off"}
          className="mt-5 space-y-3"
        >
          {lines.map((l, i) => (
            <li
              key={i}
              className={`rounded-xl px-4 py-3 ${
                l.who === "Tutor" ? "border-l-4 border-accent bg-tint" : "border border-line bg-surface"
              }`}
            >
              <span className="mr-1 text-sm font-semibold uppercase tracking-wider text-muted">{l.who}:</span> {l.text}
            </li>
          ))}
        </ol>
        {lines.length === 0 && (
          <p className="mt-5 font-serif text-lg italic text-muted">
            The conversation will appear here once you start.
          </p>
        )}
      </section>

      <footer className="mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        <p className="font-serif text-base italic text-muted">Press Escape at any time to end the conversation.</p>
        <ThemeSwitcher />
      </footer>
    </main>
  );
}
