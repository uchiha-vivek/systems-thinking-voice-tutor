"use client";

import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { FormEvent, useEffect, useRef, useState } from "react";

import { ThemeSwitcher } from "./theme-switcher";

type Model = { id: string; title: string };
type Line = { who: string; text: string };

export function Tutor() {
  return (
    <ConversationProvider>
      <TutorPage />
    </ConversationProvider>
  );
}

function TutorPage() {
  const [models, setModels] = useState<Model[]>([]);
  const [modelId, setModelId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [status, setStatus] = useState("Not connected.");
  const [lines, setLines] = useState<Line[]>([]);
  const [readAloud, setReadAloud] = useState(false);
  const [text, setText] = useState("");
  const textRef = useRef<HTMLInputElement>(null);

  const addLine = (who: string, text: string) => setLines((prev) => [...prev, { who, text }]);

  const conversation = useConversation({
    onConnect: () => setStatus("Connected. Start speaking."),
    onDisconnect: () => setStatus("Conversation ended."),
    onMessage: ({ role, message }) => addLine(role === "user" ? "You" : "Tutor", message),
    onError: (err) => setStatus(`Error: ${typeof err === "string" ? err : String(err)}`),
  });

  const running = conversation.status === "connected" || conversation.status === "connecting";

  useEffect(() => {
    (async () => {
      try {
        const [config, list] = await Promise.all([
          fetch("/api/config").then((r) => r.json()),
          fetch("/api/models").then((r) => r.json()),
        ]);
        setAgentId(config.agent_id);
        setModels(list);
        if (list.length) setModelId(list[0].id);
      } catch {
        setStatus("Could not reach the tutor server. Is the backend running?");
      }
    })();
  }, []);

  async function start() {
    const model = models.find((m) => m.id === modelId);
    if (!agentId || !model) {
      setStatus("The tutor is not configured yet.");
      return;
    }
    try {
      setStatus("Connecting…");
      await navigator.mediaDevices.getUserMedia({ audio: true });
      conversation.startSession({
        agentId,
        dynamicVariables: { model_id: model.id, model_title: model.title },
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
          Choose a model, press Start conversation, and speak. You can interrupt the tutor at any
          time. Press Escape to end.
        </p>
      </header>

      <section aria-label="Conversation" className="mt-10 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7">
        <label htmlFor="model" className="block text-sm font-semibold uppercase tracking-wider text-muted">
          Model
        </label>
        <div className="relative mt-2">
          <select
            id="model"
            className={`${field} appearance-none pr-12 font-serif text-xl`}
            value={modelId}
            disabled={running}
            onChange={(e) => setModelId(e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="pointer-events-none absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted"
          >
            <path d="M5 7.5l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>

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
