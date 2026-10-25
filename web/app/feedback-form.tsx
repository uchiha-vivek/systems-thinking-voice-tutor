"use client";

import { FormEvent, useState } from "react";

import { MAX_COMMENT } from "@/lib/feedback";

export interface Session {
  conversationId: string;
  turns: number;
  model?: string;
}

const pill =
  "cursor-pointer rounded-full border border-line px-4 py-2 transition-colors hover:border-fg " +
  "has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-on-accent " +
  "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent";

/** Asks how the session went, after it ends. Shown once per conversation. */
export function FeedbackForm({ session }: { session: Session }) {
  const [helpful, setHelpful] = useState<"yes" | "no" | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"open" | "sending" | "sent" | "failed" | "dismissed">("open");

  if (state === "dismissed") return null;
  if (state === "sent") {
    return (
      <p role="status" className="mt-6 rounded-2xl border border-line bg-surface px-5 py-4 font-serif text-lg shadow-card">
        Thanks for your feedback.
      </p>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setState("sending");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          helpful,
          rating,
          comment,
          model: session.model ?? "",
          conversation_id: session.conversationId,
          turns: session.turns,
        }),
      });
      setState(res.ok ? "sent" : "failed");
    } catch {
      setState("failed");
    }
  }

  const empty = helpful === null && rating === null && !comment.trim();

  return (
    <form
      onSubmit={submit}
      aria-labelledby="feedbackHeading"
      className="mt-6 rounded-2xl border border-line bg-surface p-5 shadow-card sm:p-7"
    >
      <h2 id="feedbackHeading" className="font-serif text-2xl font-medium">
        How was this session?
      </h2>

      <fieldset className="mt-4">
        <legend className="font-semibold">Was this helpful?</legend>
        <div className="mt-2 flex gap-2">
          {(["yes", "no"] as const).map((v) => (
            <label key={v} className={pill}>
              <input type="radio" name="helpful" value={v} checked={helpful === v} onChange={() => setHelpful(v)} className="sr-only" />
              {v === "yes" ? "Yes" : "No"}
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-4">
        <legend className="font-semibold">How helpful was it, from 1 (not at all) to 5 (very)?</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {[1, 2, 3, 4, 5].map((n) => (
            <label key={n} className={`${pill} min-w-11 text-center`}>
              <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} className="sr-only" />
              {n}
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor="feedbackComment" className="mt-4 block font-semibold">
        Anything else? <span className="font-normal text-muted">(optional)</span>
      </label>
      <textarea
        id="feedbackComment"
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={MAX_COMMENT}
        rows={3}
        aria-describedby="feedbackCommentHelp"
        className="mt-2 w-full rounded-xl border border-field bg-surface px-4 py-3 text-fg hover:border-fg"
      />
      <p id="feedbackCommentHelp" className="mt-1 text-sm text-muted">
        Please don&rsquo;t include personal information.
      </p>

      {state === "failed" && (
        <p role="alert" className="mt-3 font-semibold text-danger">
          Your feedback couldn&rsquo;t be sent right now. You can try again.
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <button
          type="submit"
          disabled={empty || state === "sending"}
          className="rounded-xl bg-accent px-5 py-2.5 font-semibold text-on-accent transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-55"
        >
          {state === "sending" ? "Sending…" : "Send feedback"}
        </button>
        <button
          type="button"
          onClick={() => setState("dismissed")}
          className="rounded-xl border border-fg px-5 py-2.5 font-semibold transition-colors hover:bg-fg hover:text-bg"
        >
          No thanks
        </button>
      </div>
    </form>
  );
}
