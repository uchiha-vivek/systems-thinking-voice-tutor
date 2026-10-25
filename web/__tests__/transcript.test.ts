import { describe, expect, it } from "vitest";

import { transcriptFileName, transcriptMailto, transcriptText } from "@/lib/transcript";

const when = new Date(2026, 9, 25, 14, 5);
const lines = [
  { who: "Tutor", text: "Hi, I'm your Systems Thinking tutor." },
  { who: "You", text: "Give me an overview" },
];

describe("transcript", () => {
  it("writes a heading, the model and one line per turn", () => {
    const text = transcriptText(lines, "Deer Population", when);
    expect(text.split("\n")).toEqual([
      "Systems Thinking Voice Tutor: transcript",
      expect.stringMatching(/^Date: October 25, 2026/),
      "Model: Deer Population",
      "",
      "Tutor: Hi, I'm your Systems Thinking tutor.",
      "You: Give me an overview",
    ]);
  });

  it("leaves the model out when none was loaded", () => {
    expect(transcriptText(lines, undefined, when)).not.toContain("Model:");
  });

  it("names the file by date", () => {
    expect(transcriptFileName(when)).toBe("tutor-transcript-2026-10-25.txt");
  });

  it("puts a short transcript in the email as is", () => {
    const { href, shortened } = transcriptMailto("Tutor: hello & welcome");
    expect(shortened).toBe(false);
    expect(href).toMatch(/^mailto:\?subject=/);
    expect(decodeURIComponent(href.split("body=")[1])).toBe("Tutor: hello & welcome");
  });

  it("shortens a long transcript and says to use Download", () => {
    const { href, shortened } = transcriptMailto("Tutor: a long answer. ".repeat(500));
    expect(shortened).toBe(true);
    expect(href.length).toBeLessThanOrEqual(1800);
    expect(decodeURIComponent(href.split("body=")[1])).toMatch(/Use Download on the tutor page/);
  });
});
