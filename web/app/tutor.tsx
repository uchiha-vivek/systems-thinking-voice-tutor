"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";

import { ModelGraph } from "@/lib/engine";
import { MODELS } from "@/lib/models";
import { parseStella, StellaError } from "@/lib/stella";
import { clientToolsFor } from "@/lib/tools";
import { transcriptFileName, transcriptMailto, transcriptText, type Line } from "@/lib/transcript";
import { DiagramView } from "./diagram";
import { FeedbackForm, type Session } from "./feedback-form";
import { ThemeToggle } from "./theme-switcher";


const MAX_FILE_BYTES = 10 * 1024 * 1024;
const UPLOAD_TAG = "[Upload]"; // marks the page's own message to the agent, so it isn't shown as the student's words

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** One plain sentence about what was loaded. Counts come from the engine, never from the AI. */
function summarize(graph: ModelGraph) {
  const ov = graph.overview() as { title: string; number_of_variables: number; number_of_loops: number };
  return `${ov.title}. It has ${plural(ov.number_of_variables, "variable")} and ${plural(ov.number_of_loops, "feedback loop")}.`;
}

function openingLine(graph: ModelGraph | null) {
  const hello = "Hi, I'm your Systems Thinking tutor.";
  return graph
    ? `${hello} I've loaded ${summarize(graph)} You can ask me questions, and I can quiz you too. Want me to describe it?`
    : `${hello} Upload your Stella model with the button on this page, and I can describe it. You can ask me questions, and I can ask you questions too.`;
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
  const transcriptRef = useRef<HTMLOListElement>(null);

  // The agent's tools run here, against whatever model is loaded right now.
  const graphRef = useRef<ModelGraph | null>(null);
  const [model, setModel] = useState<ModelGraph | null>(null); // the same model, for drawing
  // The session that just ended, so the student can rate it. Refs are read from SDK callbacks.
  const [ended, setEnded] = useState<Session | null>(null);
  const conversationIdRef = useRef("");
  const lineCountRef = useRef(0);
  const addLine = (who: string, text: string) => setLines((prev) => [...prev, { who, text }]);

  const conversation = useConversation({
    // eslint-disable-next-line react-hooks/refs -- the ref is read when the agent calls a tool, not while rendering
    clientTools: clientToolsFor(() => graphRef.current),
    onConnect: ({ conversationId }) => {
      conversationIdRef.current = conversationId;
      setStatus("Connected. Start speaking.");
    },
    onDisconnect: () => {
      const talked = lineCountRef.current > 0;
      if (talked) {
        setEnded({ conversationId: conversationIdRef.current, turns: lineCountRef.current, model: graphRef.current?.data.title });
      }
      setStatus(talked ? "Conversation ended. A short feedback form is below." : "Conversation ended.");
    },
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
    setModel(next);
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
      setLines([]); // each conversation starts with an empty transcript
      setEnded(null);
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

  /** Start over: end any call and clear the transcript. The loaded model stays. */
  function newConversation() {
    stop();
    setLines([]);
    setEnded(null);
    setText("");
    setStatus("Not connected.");
  }

  const asText = () => transcriptText(lines, model?.data.title, new Date());

  function downloadTranscript() {
    const url = URL.createObjectURL(new Blob([asText()], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = transcriptFileName(new Date());
    a.click();
    URL.revokeObjectURL(url);
  }

  function emailTranscript() {
    const { href, shortened } = transcriptMailto(asText());
    if (shortened && !window.confirm("This transcript is too long for an email link, so it will be shortened. Use Download for the full text. Continue?")) return;
    window.location.href = href;
  }

  /** "Erase memory": clear the transcript from this page. */
  function eraseTranscript() {
    const ok = window.confirm(
      "Erase this transcript from the page? This can't be undone. ElevenLabs deletes its own copy after 30 days.",
    );
    if (ok) setLines([]);
  }

  useEffect(() => {
    lineCountRef.current = lines.length;
  }, [lines]);

  // Keep the newest line in view as the conversation grows.
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines]);

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
  const diagram = model?.data.diagram;
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
    <main className={`mx-auto max-w-2xl px-4 pb-20 pt-12 sm:pt-20 ${diagram ? "lg:max-w-7xl" : ""}`}>
      <header className="flex items-start justify-between gap-4">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-accent">
            Spoken diagram tutor
          </p>
          <h1 className="mt-3 font-serif text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
            Systems Thinking <em className="font-normal">Voice Tutor</em>
          </h1>
        </div>
        <ThemeToggle />
      </header>

      <section aria-labelledby="howToHeading" className="mt-8 max-w-2xl">
        <h2 id="howToHeading" className="text-sm font-semibold uppercase tracking-wider text-muted">
          How to use it
        </h2>
        <ol className="mt-3 list-decimal space-y-1 pl-6 marker:font-semibold marker:text-accent">
          <li>Upload your Stella model, or pick an example.</li>
          <li>Press Start conversation and speak. Press Escape to end.</li>
          <li>Interrupt any time. Ask it to slow down, go faster, or say it more simply.</li>
        </ol>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-line bg-surface p-4">
            <h3 className="font-serif text-xl font-medium">Explain the model</h3>
            <p className="mt-1 text-muted">
              Ask for an overview, what affects a variable, or a walk through a loop.
            </p>
          </div>
          <div className="rounded-xl border border-line bg-surface p-4">
            <h3 className="font-serif text-xl font-medium">Test your knowledge</h3>
            <p className="mt-1 text-muted">Say &ldquo;quiz me&rdquo; and the tutor asks you questions about the model.</p>
          </div>
        </div>
      </section>

      <div className={diagram ? "lg:grid lg:grid-cols-[minmax(0,40rem)_minmax(0,1fr)] lg:gap-x-8" : ""}>
        <section aria-label="Conversation" className="mt-10 rounded-2xl lg:col-start-1 border border-line bg-surface p-5 shadow-card sm:p-7">
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

          <p id="privacyNote" className="mt-5 rounded-xl border border-line bg-tint px-4 py-3 text-sm">
            <strong className="font-semibold">Privacy:</strong> please don&rsquo;t share personal or sensitive
            information, like your full name, address or health details. Your voice is processed by
            ElevenLabs to run the tutor, and transcripts are deleted after 30 days. Your model file stays
            in your browser.
          </p>

          <button
            type="button"
            aria-pressed={running}
            aria-describedby="privacyNote"
            onClick={() => (running ? stop() : start())}
            className={`mt-3 flex w-full items-center justify-center gap-3 rounded-xl px-6 py-4 text-xl font-semibold tracking-wide shadow-sm transition hover:brightness-110 active:translate-y-px ${
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

        {ended && (
          <div className="lg:col-start-1">
            <FeedbackForm key={ended.conversationId || "session"} session={ended} />
          </div>
        )}

        {diagram && model && (
          <div className="mt-6 lg:col-start-2 lg:row-span-4 lg:row-start-1 lg:mt-10">
            <div className="lg:sticky lg:top-6">
              <DiagramView diagram={diagram} title={model.data.title} />
            </div>
          </div>
        )}

        <section className="mt-10 lg:col-start-1">
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-line pb-3">
            <h2 id="transcriptHeading" className="font-serif text-3xl font-medium">
              Transcript
            </h2>
            <div role="group" aria-label="Transcript actions" className="flex flex-wrap gap-2">
              <button type="button" onClick={newConversation} className="rounded-lg border border-fg px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-fg hover:text-bg disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-fg">
                New conversation
              </button>
              <button type="button" onClick={downloadTranscript} disabled={!lines.length} className="rounded-lg border border-fg px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-fg hover:text-bg disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-fg">
                Download
              </button>
              <button type="button" onClick={emailTranscript} disabled={!lines.length} className="rounded-lg border border-fg px-3 py-1.5 text-sm font-semibold transition-colors hover:bg-fg hover:text-bg disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-fg">
                Email to myself
              </button>
              <button
                type="button"
                onClick={eraseTranscript}
                disabled={!lines.length}
                className="rounded-lg border border-danger px-3 py-1.5 text-sm font-semibold transition-colors text-danger hover:bg-danger hover:text-on-danger disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-danger"
              >
                Erase
              </button>
            </div>
            <label className="flex w-full cursor-pointer items-center gap-2.5 text-base text-muted">
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
            ref={transcriptRef}
            aria-labelledby="transcriptHeading"
            aria-live={readAloud ? "polite" : "off"}
            className={`space-y-3 overflow-y-auto ${lines.length ? "mt-5 max-h-[28rem] pr-1" : ""}`}
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

        <form onSubmit={send} className="mt-6 rounded-2xl lg:col-start-1 border border-line bg-surface p-5 shadow-card sm:p-7">
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
      </div>

      <footer className="mt-16 border-t border-line pt-6">
        <p className="font-serif text-base italic text-muted">Press Escape at any time to end the conversation.</p>
      </footer>
    </main>
  );
}
