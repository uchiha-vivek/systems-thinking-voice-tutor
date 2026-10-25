// Checking the after-session feedback a student sends, before it is saved to the Google Sheet.
// Only these fields are kept: no transcript, no voice, nothing else from the conversation.

export interface Feedback {
  helpful: "yes" | "no" | null;
  /** 1 (not helpful) to 5 (very helpful). */
  rating: number | null;
  comment: string;
  /** The model's title, if one was loaded. */
  model: string;
  /** ElevenLabs conversation id, so the transcript can be found in the dashboard. */
  conversation_id: string;
  /** How many lines the transcript had. */
  turns: number | null;
}

export const MAX_COMMENT = 1000;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The cleaned feedback, or an error message when there's nothing usable in it. */
export function parseFeedback(body: unknown): { feedback: Feedback } | { error: string } {
  if (!body || typeof body !== "object") return { error: "Expected a JSON object." };
  const b = body as Record<string, unknown>;
  const helpful = b.helpful === "yes" || b.helpful === "no" ? b.helpful : null;
  const rating = Number.isInteger(b.rating) && (b.rating as number) >= 1 && (b.rating as number) <= 5 ? (b.rating as number) : null;
  const comment = str(b.comment, MAX_COMMENT);
  if (helpful === null && rating === null && !comment) return { error: "The feedback was empty." };
  const id = str(b.conversation_id, 100);
  const turns = Number.isInteger(b.turns) && (b.turns as number) >= 0 ? Math.min(b.turns as number, 100000) : null;
  return {
    feedback: {
      helpful,
      rating,
      comment,
      model: str(b.model, 200),
      conversation_id: /^[A-Za-z0-9_-]+$/.test(id) ? id : "",
      turns,
    },
  };
}
