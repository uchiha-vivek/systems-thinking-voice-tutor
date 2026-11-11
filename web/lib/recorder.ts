// Records a voice session in the student's browser: their microphone plus the tutor's voice,
// mixed into one audio file they can download. Nothing is uploaded; the recording lives only in
// this page until they download it or leave.
//
// The tutor's voice arrives from the ElevenLabs SDK's onAudio callback as base64 16-bit PCM. Over
// the default WebRTC connection that is 48 kHz mono, captured as it plays, so each chunk is
// scheduled at the time it arrives (silent stretches are skipped by the SDK, not by us).

export const AGENT_SAMPLE_RATE = 48_000;

/** Base64 16-bit little-endian PCM -> samples between -1 and 1. */
export function pcm16ToFloat(base64: string): Float32Array<ArrayBuffer> {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const out = new Float32Array(Math.floor(bytes.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
  return out;
}

/** The first audio type this browser can record: Opus in WebM (Chrome, Firefox), else MP4 (Safari). */
export function pickMimeType(isSupported: (t: string) => boolean): string {
  return ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find(isSupported) ?? "";
}

export function recordingFileName(when: Date, mimeType: string): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ext = mimeType.includes("mp4") ? "m4a" : "webm";
  return `tutor-recording-${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}.${ext}`;
}

export class CallRecorder {
  private ctx: AudioContext;
  private dest: MediaStreamAudioDestinationNode;
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  private nextAt = 0;
  private playing = new Set<AudioBufferSourceNode>();
  readonly mimeType: string;

  /** Start recording `mic`. Call from a click, so the browser lets the audio context run. */
  constructor(mic: MediaStream) {
    this.ctx = new AudioContext();
    this.dest = this.ctx.createMediaStreamDestination();
    this.ctx.createMediaStreamSource(mic).connect(this.dest);
    this.mimeType = pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    this.recorder = new MediaRecorder(this.dest.stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
    this.recorder.ondataavailable = (e) => {
      if (e.data.size) this.chunks.push(e.data);
    };
    this.recorder.start(1000);
  }

  /** Mix in one chunk of the tutor's voice. It goes to the recording only, not the speakers. */
  addAgentAudio(base64: string, sampleRate = AGENT_SAMPLE_RATE) {
    if (this.recorder.state !== "recording") return;
    const samples = pcm16ToFloat(base64);
    if (!samples.length) return;
    const buffer = this.ctx.createBuffer(1, samples.length, sampleRate);
    buffer.copyToChannel(samples, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.dest);
    const at = Math.max(this.ctx.currentTime, this.nextAt);
    src.start(at);
    this.nextAt = at + buffer.duration;
    this.playing.add(src);
    src.onended = () => this.playing.delete(src);
  }

  /** The student cut the tutor off: drop the tutor audio that hasn't been heard yet. */
  interrupt() {
    for (const src of this.playing) src.stop();
    this.playing.clear();
    this.nextAt = this.ctx.currentTime;
  }

  /** Stop and hand back the whole recording. */
  async stop(): Promise<Blob> {
    if (this.recorder.state !== "inactive") {
      await new Promise<void>((resolve) => {
        this.recorder.onstop = () => resolve();
        this.recorder.stop();
      });
    }
    await this.ctx.close().catch(() => {});
    return new Blob(this.chunks, { type: this.mimeType || "audio/webm" });
  }
}
