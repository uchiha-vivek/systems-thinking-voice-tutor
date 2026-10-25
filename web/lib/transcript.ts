// Turning the on-screen transcript into a file or an email the student sends to themselves.
// Everything stays in the browser: the download is made locally, and the email opens in the
// student's own mail app.

export type Line = { who: string; text: string };

// Some mail apps cut off or refuse longer mailto links, so keep well under the usual ~2000.
const MAX_MAILTO = 1800;

/** Plain text with a short heading, one line per turn. */
export function transcriptText(lines: Line[], modelTitle: string | undefined, when: Date): string {
  const head = [
    "Systems Thinking Voice Tutor: transcript",
    `Date: ${when.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}`,
    ...(modelTitle ? [`Model: ${modelTitle}`] : []),
  ];
  return [...head, "", ...lines.map((l) => `${l.who}: ${l.text}`)].join("\n");
}

/** "tutor-transcript-2026-10-25.txt" */
export function transcriptFileName(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `tutor-transcript-${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}.txt`;
}

/** A mailto: link with the transcript as the body, shortened if it would be too long. */
export function transcriptMailto(text: string): { href: string; shortened: boolean } {
  const subject = encodeURIComponent("My Systems Thinking tutor transcript");
  const build = (body: string) => `mailto:?subject=${subject}&body=${encodeURIComponent(body)}`;
  let href = build(text);
  if (href.length <= MAX_MAILTO) return { href, shortened: false };
  const note = "\n\n[Shortened. Use Download on the tutor page for the full transcript.]";
  let keep = text.length;
  while (keep > 0 && (href = build(text.slice(0, keep) + note)).length > MAX_MAILTO) {
    keep = Math.floor(keep * 0.9);
  }
  return { href, shortened: true };
}
