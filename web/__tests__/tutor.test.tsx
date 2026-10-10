import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Tutor } from "@/app/tutor";
import { TINY_SIR } from "./fixtures/tiny-sir";

type Options = {
  clientTools: Record<string, (args: unknown) => string>;
  onConnect?: () => void;
  onMessage?: (m: { role: string; message: string }) => void;
} & Record<string, unknown>;

// Stand-in for the ElevenLabs SDK: no mic, no network. Tests flip `status` and call the
// captured options to simulate what the real agent would do.
const sdk = vi.hoisted(() => ({
  status: "disconnected" as string,
  isSpeaking: false,
  startSession: vi.fn(),
  endSession: vi.fn(),
  sendUserMessage: vi.fn(),
  options: {} as unknown,
}));
const opts = () => sdk.options as Options;

vi.mock("@elevenlabs/react", () => ({
  ConversationProvider: ({ children }: { children: React.ReactNode }) => children,
  useConversation: (options: unknown) => {
    sdk.options = options;
    return {
      status: sdk.status,
      isSpeaking: sdk.isSpeaking,
      startSession: sdk.startSession,
      endSession: sdk.endSession,
      sendUserMessage: sdk.sendUserMessage,
    };
  },
}));

function mockServer({ up = true } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (!up) throw new TypeError("Failed to fetch");
      return { json: async () => ({ agent_id: "agent_test" }) } as Response;
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

const file = (name: string, content: string) => new File([content], name, { type: "text/xml" });
// A real file dialog can be switched to "All files", so don't let the test filter by `accept`.
const upload = (f: File) => userEvent.setup({ applyAccept: false }).upload(screen.getByLabelText("Your model"), f);
const loadExample = (title: string) => userEvent.click(screen.getByRole("button", { name: title }));

async function renderReady() {
  const view = render(<Tutor />);
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/config"));
  return view;
}

function connect(view: ReturnType<typeof render>) {
  sdk.status = "connected";
  act(() => opts().onConnect?.());
  view.rerender(<Tutor />);
}

beforeEach(() => {
  sdk.status = "disconnected";
  sdk.isSpeaking = false;
  sdk.startSession.mockReset();
  sdk.endSession.mockReset();
  sdk.sendUserMessage.mockReset();
  mockServer();
  mockMic();
});

describe("loading a model", () => {
  it("starts idle with nothing loaded", async () => {
    await renderReady();
    expect(screen.getByRole("status")).toHaveTextContent("Not connected.");
    expect(screen.getByLabelText("Your model")).toHaveAttribute("type", "file");
    expect(screen.getByRole("button", { name: "Start conversation" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Or type a question")).toBeDisabled();
  });

  it("reads an uploaded Stella file and says what it found", async () => {
    await renderReady();
    await upload(file("tiny.stmx", TINY_SIR));
    expect(await screen.findByText("Loaded Tiny SIR model. It has 8 variables and 3 feedback loops.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("loads a built-in example", async () => {
    await renderReady();
    await loadExample("Deer Population");
    expect(screen.getByText("Loaded Deer Population. It has 3 variables and 2 feedback loops.")).toBeInTheDocument();
  });

  it("explains that pictures and PDFs are not supported yet", async () => {
    await renderReady();
    await upload(new File(["x"], "diagram.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/Pictures and PDFs are not supported yet.*\.stmx/);
  });

  it("says so when the file is not a Stella model", async () => {
    await renderReady();
    await upload(file("notes.stmx", "just some text"));
    expect(await screen.findByRole("alert")).toHaveTextContent(/probably not a Stella model/);
  });

  it("keeps the previous model when a new file fails", async () => {
    await renderReady();
    await loadExample("Deer Population");
    await upload(file("bad.stmx", "nope"));
    await screen.findByRole("alert");
    act(() => undefined);
    expect(opts().clientTools.get_overview({})).toContain("Deer Population");
  });
});

describe("starting a conversation", () => {
  it("greets with the loaded model, taken from the engine's own counts", async () => {
    const getUserMedia = mockMic();
    await renderReady();
    await loadExample("Deer Population");
    await userEvent.click(screen.getByRole("button", { name: "Start conversation" }));

    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(sdk.startSession).toHaveBeenCalledWith({
      agentId: "agent_test",
      dynamicVariables: {
        opening:
          "Hi! I'm your Systems Thinking tutor. I've loaded Deer Population. It has 3 variables and 2 feedback loops. Would you like me to describe it?",
      },
    });
  });

  it("can start with nothing loaded: the agent asks for an upload", async () => {
    await renderReady();
    await userEvent.click(screen.getByRole("button", { name: "Start conversation" }));
    const call = sdk.startSession.mock.calls[0][0];
    expect(call.dynamicVariables.opening).toMatch(/upload your Stella model/);
  });

  it("explains a blocked microphone instead of starting", async () => {
    mockMic({ allowed: false });
    await renderReady();
    await userEvent.click(screen.getByRole("button", { name: "Start conversation" }));
    expect(sdk.startSession).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent(/Could not start: Permission denied.*microphone/);
  });

  it("says so when the server is down", async () => {
    mockServer({ up: false });
    render(<Tutor />);
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Could not reach the tutor server"));
  });

  it("once connected: Stop button and an enabled text box", async () => {
    const view = await renderReady();
    connect(view);
    expect(screen.getByRole("status")).toHaveTextContent("Connected. Start speaking.");
    expect(screen.getByRole("button", { name: "Stop conversation" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Or type a question")).toBeEnabled();
  });
});

describe("uploading during a conversation", () => {
  it("tells the agent, and shows a note instead of the page's own message", async () => {
    const view = await renderReady();
    connect(view);
    await upload(file("tiny.stmx", TINY_SIR));
    await screen.findByText(/Loaded Tiny SIR model/);

    expect(sdk.sendUserMessage).toHaveBeenCalledTimes(1);
    expect(sdk.sendUserMessage.mock.calls[0][0]).toMatch(/^\[Upload\] .*Tiny SIR model\. It has 8 variables and 3 feedback loops/);
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["You (uploaded): Tiny SIR model"]);

    // the SDK echoes the message back as the user's; it must not appear as their words
    act(() => opts().onMessage?.({ role: "user", message: sdk.sendUserMessage.mock.calls[0][0] }));
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("does not message the agent when no conversation is running", async () => {
    await renderReady();
    await loadExample("Deer Population");
    expect(sdk.sendUserMessage).not.toHaveBeenCalled();
  });
});

describe("the agent's tools", () => {
  it("answer that nothing is loaded until a model is", async () => {
    await renderReady();
    expect(JSON.parse(opts().clientTools.get_overview({})).error).toMatch(/No model has been loaded/);
  });

  it("answer from the model the student loaded, not from the AI", async () => {
    await renderReady();
    await upload(file("tiny.stmx", TINY_SIR));
    await screen.findByText(/Loaded Tiny SIR model/);
    const tools = opts().clientTools;

    expect(JSON.parse(tools.get_overview({})).title).toBe("Tiny SIR model");
    const loop = JSON.parse(tools.get_loop({ query: "reinforcing loop" }));
    expect(loop.type).toBe("reinforcing");
    expect(loop.steps_in_order).toEqual([
      "When Infected Population I goes up, Infection Rate goes up.",
      "When Infection Rate goes up, Infected Population I fills faster.",
    ]);
    expect(loop.closes_back_to).toBe("Infected Population I");
    const path = JSON.parse(tools.find_path({ from_name: "contact rate", to_name: "infected" }));
    expect(path.paths[0].overall).toBe("If Contact Rate goes up, Infected Population I goes up through this chain.");
  });

  it("switch to a newly loaded model", async () => {
    await renderReady();
    await loadExample("Deer Population");
    expect(JSON.parse(opts().clientTools.get_overview({})).title).toBe("Deer Population");
    await loadExample("Formal and Informal Water Supply");
    expect(JSON.parse(opts().clientTools.get_overview({})).title).toBe("Formal and Informal Water Supply");
  });
});

describe("conversation", () => {
  it("shows spoken messages from both sides in the transcript", async () => {
    const view = await renderReady();
    connect(view);
    act(() => opts().onMessage?.({ role: "agent", message: "Hi! I'm your tutor." }));
    act(() => opts().onMessage?.({ role: "user", message: "Give me an overview" }));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Tutor: Hi! I'm your tutor.",
      "You: Give me an overview",
    ]);
  });

  it("sends a typed question and clears the box", async () => {
    const view = await renderReady();
    connect(view);
    const input = screen.getByLabelText("Or type a question");
    await userEvent.type(input, "repeat that{Enter}");
    expect(sdk.sendUserMessage).toHaveBeenCalledWith("repeat that");
    expect(screen.getByText("You (typed):")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });

  it("ignores an empty typed question", async () => {
    const view = await renderReady();
    connect(view);
    await userEvent.type(screen.getByLabelText("Or type a question"), "   {Enter}");
    expect(sdk.sendUserMessage).not.toHaveBeenCalled();
  });

  it("Escape ends a running conversation", async () => {
    const view = await renderReady();
    connect(view);
    await userEvent.keyboard("{Escape}");
    expect(sdk.endSession).toHaveBeenCalled();
  });

  it("Escape does nothing when no conversation is running", async () => {
    await renderReady();
    await userEvent.keyboard("{Escape}");
    expect(sdk.endSession).not.toHaveBeenCalled();
  });

  it("transcript is silent for screen readers until the student opts in", async () => {
    await renderReady();
    const transcript = screen.getByRole("list", { name: "Transcript" });
    expect(transcript).toHaveAttribute("aria-live", "off");
    await userEvent.click(screen.getByLabelText("Let my screen reader read new transcript lines"));
    expect(transcript).toHaveAttribute("aria-live", "polite");
  });

  it("announces a loaded model to screen readers", async () => {
    await renderReady();
    await loadExample("Deer Population");
    expect(screen.getByText(/Loaded Deer Population/)).toHaveAttribute("aria-live", "polite");
  });

  it("keyboard tab order: upload, examples, Start, text box, Send, checkbox", async () => {
    const view = await renderReady();
    connect(view); // the text box and Send are only focusable once connected
    const order = [
      screen.getByLabelText("Your model"),
      screen.getByRole("button", { name: "Deer Population" }),
      screen.getByRole("button", { name: "Formal and Informal Water Supply" }),
      screen.getByRole("button", { name: "Stop conversation" }),
      screen.getByLabelText("Or type a question"),
      screen.getByRole("button", { name: "Send" }),
      screen.getByLabelText("Let my screen reader read new transcript lines"),
    ];
    for (const el of order) {
      await userEvent.tab();
      expect(el).toHaveFocus();
    }
  });
});
