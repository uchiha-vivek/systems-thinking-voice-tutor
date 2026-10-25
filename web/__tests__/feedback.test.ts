// @vitest-environment node
// The after-session feedback: what is accepted, and how the route hands it to the Google Sheet.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "@/app/api/feedback/route";
import { parseFeedback } from "@/lib/feedback";

const good = { helpful: "yes", rating: 4, comment: "Clear!", model: "Deer Population", conversation_id: "conv_123", turns: 6 };
const post = (body: unknown) =>
  POST(new Request("http://localhost/api/feedback", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("parseFeedback", () => {
  it("keeps the expected fields", () => {
    expect(parseFeedback(good)).toEqual({ feedback: good });
  });

  it("drops anything out of range instead of saving it", () => {
    const r = parseFeedback({ helpful: "maybe", rating: 9, comment: "ok", conversation_id: "<script>", turns: -1 });
    expect(r).toEqual({ feedback: { helpful: null, rating: null, comment: "ok", model: "", conversation_id: "", turns: null } });
  });

  it("cuts long comments to 1000 characters", () => {
    const r = parseFeedback({ comment: "a".repeat(5000) });
    expect("feedback" in r && r.feedback.comment.length).toBe(1000);
  });

  it("rejects empty feedback", () => {
    expect(parseFeedback({ helpful: null, comment: "  " })).toEqual({ error: "The feedback was empty." });
    expect(parseFeedback("hi")).toEqual({ error: "Expected a JSON object." });
  });
});

describe("POST /api/feedback", () => {
  beforeEach(() => {
    vi.stubEnv("FEEDBACK_SHEET_URL", "https://script.google.com/macros/s/test/exec");
    vi.stubEnv("FEEDBACK_SECRET", "s3cret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("says so when the sheet isn't set up", async () => {
    vi.stubEnv("FEEDBACK_SHEET_URL", "");
    expect((await post(good)).status).toBe(503);
  });

  it("rejects bad requests without calling the sheet", async () => {
    const sheet = vi.fn();
    vi.stubGlobal("fetch", sheet);
    expect((await post("not json")).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ comment: "x".repeat(5000) })).status).toBe(413);
    expect(sheet).not.toHaveBeenCalled();
  });

  it("sends the cleaned feedback and the secret to the sheet", async () => {
    const sheet = vi.fn(async () => Response.json({ ok: true }));
    vi.stubGlobal("fetch", sheet);
    const res = await post({ ...good, extra: "ignored" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    const [url, init] = sheet.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://script.google.com/macros/s/test/exec");
    expect(JSON.parse(init.body as string)).toEqual({ ...good, secret: "s3cret" });
  });

  it("reports a failure when the sheet doesn't confirm the row", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ ok: false, error: "forbidden" })));
    expect((await post(good)).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("offline"))));
    expect((await post(good)).status).toBe(502);
  });
});
