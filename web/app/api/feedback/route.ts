// Saves after-session feedback to a Google Sheet through its Apps Script web app
// (scripts/feedback-sheet.gs). The sheet's URL and a shared secret stay on the server.
import { parseFeedback } from "@/lib/feedback";

const MAX_BODY = 4096;

export async function POST(request: Request) {
  const url = process.env.FEEDBACK_SHEET_URL;
  const secret = process.env.FEEDBACK_SECRET;
  if (!url || !secret) return Response.json({ error: "Feedback is not set up." }, { status: 503 });

  const raw = await request.text();
  if (raw.length > MAX_BODY) return Response.json({ error: "Too long." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }
  const parsed = parseFeedback(body);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...parsed.feedback, secret }),
      signal: AbortSignal.timeout(10_000),
    });
    // Apps Script can't set a status code, so it answers {"ok": true} when the row was added.
    const reply = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    if (!res.ok || !reply?.ok) return Response.json({ error: "Could not save." }, { status: 502 });
  } catch {
    return Response.json({ error: "Could not save." }, { status: 502 });
  }
  return Response.json({ ok: true });
}
