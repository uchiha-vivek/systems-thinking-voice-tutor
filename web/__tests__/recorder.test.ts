// @vitest-environment jsdom
// Recording a session in the browser: the student's mic plus the tutor's voice, mixed.
import { afterEach, describe, expect, it, vi } from "vitest";

import { CallRecorder, pcm16ToFloat, pickMimeType, recordingFileName } from "@/lib/recorder";

const b64 = (samples: number[]) => {
  const buf = new DataView(new ArrayBuffer(samples.length * 2));
  samples.forEach((v, i) => buf.setInt16(i * 2, v, true));
  return btoa(String.fromCharCode(...new Uint8Array(buf.buffer)));
};

describe("helpers", () => {
  it("turns 16-bit PCM into samples between -1 and 1", () => {
    expect([...pcm16ToFloat(b64([0, 16384, -32768]))]).toEqual([0, 0.5, -1]);
  });

  it("picks Opus where it can and MP4 on Safari", () => {
    expect(pickMimeType(() => true)).toBe("audio/webm;codecs=opus");
    expect(pickMimeType((t) => t === "audio/mp4")).toBe("audio/mp4");
    expect(pickMimeType(() => false)).toBe("");
  });

  it("names the file by date with the right extension", () => {
    const d = new Date(2026, 10, 3);
    expect(recordingFileName(d, "audio/webm;codecs=opus")).toBe("tutor-recording-2026-11-03.webm");
    expect(recordingFileName(d, "audio/mp4")).toBe("tutor-recording-2026-11-03.m4a");
  });
});

// Minimal stand-ins for the browser's audio classes.
class FakeSource {
  started: number[] = [];
  stopped = false;
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  connect = vi.fn();
  start(at: number) {
    this.started.push(at);
  }
  stop() {
    this.stopped = true;
  }
}
const sources: FakeSource[] = [];
class FakeContext {
  currentTime = 10;
  createMediaStreamDestination = () => ({ stream: {} });
  createMediaStreamSource = () => ({ connect: vi.fn() });
  createBuffer = (_c: number, n: number, rate: number) => ({ duration: n / rate, copyToChannel: vi.fn() });
  createBufferSource = () => {
    const s = new FakeSource();
    sources.push(s);
    return s;
  };
  close = vi.fn(async () => {});
}
class FakeRecorder {
  static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
  state = "inactive";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.ondataavailable?.({ data: new Blob(["audio"]) });
    this.state = "inactive";
    this.onstop?.();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  sources.length = 0;
});

describe("CallRecorder", () => {
  it("lines tutor chunks up one after another and drops unheard audio on interruption", async () => {
    vi.stubGlobal("AudioContext", FakeContext);
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    const rec = new CallRecorder({} as MediaStream);
    const half = b64(new Array(24_000).fill(0)); // half a second at 48 kHz
    rec.addAgentAudio(half);
    rec.addAgentAudio(half);
    expect(sources.map((s) => s.started[0])).toEqual([10, 10.5]);

    rec.interrupt();
    expect(sources.every((s) => s.stopped)).toBe(true);
    rec.addAgentAudio(half);
    expect(sources[2].started[0]).toBe(10); // starts now, not after the dropped audio

    const blob = await rec.stop();
    expect(blob.size).toBeGreaterThan(0);
    expect(blob.type).toBe("audio/webm;codecs=opus");
    rec.addAgentAudio(half); // ignored once stopped
    expect(sources).toHaveLength(3);
  });
});
