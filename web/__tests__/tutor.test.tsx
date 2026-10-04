import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Tutor } from "@/app/tutor";

// Stand-in for the ElevenLabs SDK: no mic, no network. Tests flip `status` and call the
// captured callbacks to simulate what the real agent would do.
const sdk = vi.hoisted(() => ({
  status: "disconnected" as string,
  isSpeaking: false,
  startSession: vi.fn(),
  endSession: vi.fn(),
  sendUserMessage: vi.fn(),
  callbacks: {} as Record<string, (arg?: unknown) => void>,
}));

vi.mock("@elevenlabs/react", () => ({
  ConversationProvider: ({ children }: { children: React.ReactNode }) => children,
  useConversation: (callbacks: Record<string, (arg?: unknown) => void>) => {
    sdk.callbacks = callbacks;
    return {
      status: sdk.status,
      isSpeaking: sdk.isSpeaking,
      startSession: sdk.startSession,
      endSession: sdk.endSession,
      sendUserMessage: sdk.sendUserMessage,
    };
  },
}));

const MODELS = [
  { id: "deer-population", title: "Deer Population" },
  { id: "water-supply", title: "Formal and Informal Water Supply" },
];

function mockBackend({ up = true } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (!up) throw new TypeError("Failed to fetch");
      const body = url === "/api/config" ? { agent_id: "agent_test" } : MODELS;
      return { json: async () => body } as Response;
    }),
  );
}

function mockMic({ allowed = true } = {}) {
  const getUserMedia = allowed
    ? vi.fn().mockResolvedValue({})
    : vi.fn().mockRejectedValue(new Error("Permission denied"));
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  return getUserMedia;
}

async function renderLoaded() {
  const view = render(<Tutor />);
  await screen.findByRole("option", { name: "Formal and Informal Water Supply" });
  return view;
}

function connect(view: ReturnType<typeof render>) {
  sdk.status = "connected";
  act(() => sdk.callbacks.onConnect?.());
  view.rerender(<Tutor />);
}

beforeEach(() => {
  sdk.status = "disconnected";
  sdk.isSpeaking = false;
  sdk.startSession.mockReset();
  sdk.endSession.mockReset();
  sdk.sendUserMessage.mockReset();
  mockBackend();
  mockMic();
});

describe("Tutor page", () => {
  it("loads the models from the backend and starts idle", async () => {
    await renderLoaded();
    expect(screen.getByLabelText("Model")).toHaveValue("deer-population");
    expect(screen.getByRole("status")).toHaveTextContent("Not connected.");
    expect(screen.getByRole("button", { name: "Start conversation" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Or type a question")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });

  it("starts a session with the chosen model as dynamic variables", async () => {
    const getUserMedia = mockMic();
    await renderLoaded();
    await userEvent.selectOptions(screen.getByLabelText("Model"), "water-supply");
    await userEvent.click(screen.getByRole("button", { name: "Start conversation" }));

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(sdk.startSession).toHaveBeenCalledWith({
      agentId: "agent_test",
      dynamicVariables: { model_id: "water-supply", model_title: "Formal and Informal Water Supply" },
    });
  });

  it("explains a blocked microphone instead of starting", async () => {
    mockMic({ allowed: false });
    await renderLoaded();
    await userEvent.click(screen.getByRole("button", { name: "Start conversation" }));

    expect(sdk.startSession).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/Could not start: Permission denied.*microphone/);
  });

  it("says so when the backend is down", async () => {
    mockBackend({ up: false });
    render(<Tutor />);
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Could not reach the tutor server"),
    );
  });

  it("once connected: Stop button, enabled text box, model locked", async () => {
    const view = await renderLoaded();
    connect(view);

    expect(screen.getByRole("status")).toHaveTextContent("Connected. Start speaking.");
    expect(screen.getByRole("button", { name: "Stop conversation" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Or type a question")).toBeEnabled();
    expect(screen.getByLabelText("Model")).toBeDisabled();
  });

  it("shows spoken messages from both sides in the transcript", async () => {
    const view = await renderLoaded();
    connect(view);
    act(() => sdk.callbacks.onMessage?.({ role: "agent", message: "Hi! I'm your tutor." }));
    act(() => sdk.callbacks.onMessage?.({ role: "user", message: "Give me an overview" }));

    const items = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(items).toEqual(["Tutor: Hi! I'm your tutor.", "You: Give me an overview"]);
  });

  it("sends a typed question and clears the box", async () => {
    const view = await renderLoaded();
    connect(view);
    const input = screen.getByLabelText("Or type a question");
    await userEvent.type(input, "repeat that{Enter}");

    expect(sdk.sendUserMessage).toHaveBeenCalledWith("repeat that");
    expect(screen.getByText("You (typed):")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("ignores an empty typed question", async () => {
    const view = await renderLoaded();
    connect(view);
    await userEvent.type(screen.getByLabelText("Or type a question"), "   {Enter}");
    expect(sdk.sendUserMessage).not.toHaveBeenCalled();
  });

  it("Escape ends a running conversation", async () => {
    const view = await renderLoaded();
    connect(view);
    await userEvent.keyboard("{Escape}");
    expect(sdk.endSession).toHaveBeenCalled();
  });

  it("Escape does nothing when no conversation is running", async () => {
    await renderLoaded();
    await userEvent.keyboard("{Escape}");
    expect(sdk.endSession).not.toHaveBeenCalled();
  });

  it("transcript is silent for screen readers until the student opts in", async () => {
    await renderLoaded();
    const transcript = screen.getByRole("list", { name: "Transcript" });
    expect(transcript).toHaveAttribute("aria-live", "off");
    await userEvent.click(screen.getByLabelText("Let my screen reader read new transcript lines"));
    expect(transcript).toHaveAttribute("aria-live", "polite");
  });

  it("keyboard tab order is model, Start, text box, Send, checkbox", async () => {
    const view = await renderLoaded();
    connect(view); // text box and Send are only focusable once connected
    const order = [
      screen.getByLabelText("Model"),
      screen.getByRole("button", { name: "Stop conversation" }),
      screen.getByLabelText("Or type a question"),
      screen.getByRole("button", { name: "Send" }),
      screen.getByLabelText("Let my screen reader read new transcript lines"),
    ];
    // Model is disabled while connected, so start from the button.
    for (const el of order.slice(1)) {
      await userEvent.tab();
      expect(el).toHaveFocus();
    }
  });
});
