import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Tutor } from "@/app/tutor";
import { DRAWN_MODEL } from "./fixtures/drawn-model";
import { TINY_SIR } from "./fixtures/tiny-sir";

type Options = {
  clientTools: Record<string, (args: unknown) => string>;
  onConnect?: (p: { conversationId: string }) => void;
  onDisconnect?: () => void;
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
const transcriptLines = () => within(screen.getByRole("list", { name: "Transcript" })).queryAllByRole("listitem");

async function renderReady() {
  const view = render(<Tutor />);
  await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/config"));
  return view;
}

function connect(view: ReturnType<typeof render>) {
  sdk.status = "connected";
  act(() => opts().onConnect?.({ conversationId: "conv_test" }));
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

  it("warns about sharing personal information, and screen readers hear it on the Start button", async () => {
    await renderReady();
    const start = screen.getByRole("button", { name: "Start conversation" });
    expect(start).toHaveAccessibleDescription(/don.t share personal or sensitive information/);
    expect(start).toHaveAccessibleDescription(/deleted after 30 days/);
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
          "Hi, I'm your Systems Thinking tutor. I've loaded Deer Population. It has 3 variables and 2 feedback loops. You can ask me questions, and I can quiz you too. Want me to describe it?",
      },
    });
  });

  it("can start with nothing loaded: the agent asks for an upload", async () => {
    await renderReady();
    await userEvent.click(screen.getByRole("button", { name: "Start conversation" }));
    const call = sdk.startSession.mock.calls[0][0];
    expect(call.dynamicVariables.opening).toMatch(/Upload your Stella model/);
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
    expect(transcriptLines().map((li) => li.textContent)).toEqual(["You (uploaded): Tiny SIR model"]);

    // the SDK echoes the message back as the user's; it must not appear as their words
    act(() => opts().onMessage?.({ role: "user", message: sdk.sendUserMessage.mock.calls[0][0] }));
    expect(transcriptLines()).toHaveLength(1);
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
    expect(transcriptLines().map((li) => li.textContent)).toEqual([
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

  it("keyboard tab order: theme, upload, examples, Start, New conversation, checkbox, text box, Send", async () => {
    const view = await renderReady();
    connect(view); // the text box and Send are only focusable once connected
    const order = [
      screen.getByRole("button", { name: /^Switch to (dark|light) mode$/ }),
      screen.getByLabelText("Your model"),
      screen.getByRole("button", { name: "Deer Population" }),
      screen.getByRole("button", { name: "Formal and Informal Water Supply" }),
      screen.getByRole("button", { name: "Stop conversation" }),
      screen.getByRole("button", { name: "New conversation" }),
      screen.getByLabelText("Let my screen reader read new transcript lines"),
      screen.getByLabelText("Or type a question"),
      screen.getByRole("button", { name: "Send" }),
    ];
    for (const el of order) {
      await userEvent.tab();
      expect(el).toHaveFocus();
    }
  });
});

describe("starting over", () => {
  it("New conversation ends the call and clears the transcript", async () => {
    const view = await renderReady();
    connect(view);
    act(() => opts().onMessage?.({ role: "agent", message: "Hi, I'm your tutor." }));
    expect(transcriptLines()).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(sdk.endSession).toHaveBeenCalled();
    expect(transcriptLines()).toHaveLength(0);
    expect(screen.getByText("The conversation will appear here once you start.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Not connected.");
  });

  it("New conversation keeps the loaded model", async () => {
    await renderReady();
    await loadExample("Deer Population");
    await userEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(sdk.endSession).not.toHaveBeenCalled(); // nothing was running
    expect(opts().clientTools.get_overview({})).toContain("Deer Population");
  });

  it("starting again clears the previous transcript", async () => {
    const view = await renderReady();
    connect(view);
    act(() => opts().onMessage?.({ role: "agent", message: "Old answer" }));
    sdk.status = "disconnected";
    view.rerender(<Tutor />);
    await userEvent.click(screen.getByRole("button", { name: "Start conversation" }));
    expect(transcriptLines()).toHaveLength(0);
    expect(sdk.startSession).toHaveBeenCalled();
  });
});

describe("the diagram", () => {
  it("draws the uploaded model when the file saves positions", async () => {
    await renderReady();
    await upload(file("drawn.stmx", DRAWN_MODEL));
    const figure = await screen.findByRole("figure");
    expect(figure).toHaveTextContent(/Drawn population, drawn from your file/);
    expect(figure.querySelector("svg")).toHaveAttribute("aria-hidden", "true"); // the tutor describes it aloud instead
  });

  it("shows no drawing for a model without positions", async () => {
    await renderReady();
    await loadExample("Deer Population");
    expect(screen.queryByRole("figure")).not.toBeInTheDocument();
  });
});

describe("transcript actions", () => {
  async function withLines() {
    const view = await renderReady();
    await loadExample("Deer Population");
    connect(view);
    act(() => opts().onMessage?.({ role: "agent", message: "Hi, I'm your tutor." }));
    act(() => opts().onMessage?.({ role: "user", message: "Give me an overview" }));
    return view;
  }

  it("are disabled until there is something to save or erase", async () => {
    await renderReady();
    for (const name of ["Download", "Email to myself", "Erase"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
  });

  it("Download saves the transcript as a text file", async () => {
    await withLines();
    const created: Blob[] = [];
    vi.stubGlobal("URL", { ...URL, createObjectURL: (b: Blob) => (created.push(b), "blob:x"), revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    await userEvent.click(screen.getByRole("button", { name: "Download" }));
    expect(click).toHaveBeenCalled();
    const text = await created[0].text();
    expect(text).toContain("Model: Deer Population");
    expect(text).toContain("Tutor: Hi, I'm your tutor.\nYou: Give me an overview");
    click.mockRestore();
    vi.unstubAllGlobals();
    mockServer();
    mockMic();
  });

  it("Erase asks first, then clears the transcript", async () => {
    await withLines();
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole("button", { name: "Erase" }));
    expect(transcriptLines()).toHaveLength(2); // said no
    await userEvent.click(screen.getByRole("button", { name: "Erase" }));
    expect(confirm).toHaveBeenLastCalledWith(expect.stringMatching(/ElevenLabs deletes its own copy after 30 days/));
    expect(transcriptLines()).toHaveLength(0);
    confirm.mockRestore();
  });
});

describe("feedback after a session", () => {
  async function endAfterTalking() {
    const view = await renderReady();
    await loadExample("Deer Population");
    connect(view);
    act(() => opts().onMessage?.({ role: "agent", message: "Hi, I'm your tutor." }));
    sdk.status = "disconnected";
    act(() => opts().onDisconnect?.());
    view.rerender(<Tutor />);
    return view;
  }

  it("is offered once a conversation with messages ends", async () => {
    await endAfterTalking();
    expect(screen.getByRole("status")).toHaveTextContent("Conversation ended. A short feedback form is below.");
    expect(screen.getByRole("form", { name: "How was this session?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send feedback" })).toBeDisabled(); // nothing chosen yet
  });

  it("is not offered when nothing was said", async () => {
    const view = await renderReady();
    connect(view);
    act(() => opts().onDisconnect?.());
    expect(screen.queryByRole("form", { name: "How was this session?" })).not.toBeInTheDocument();
  });

  it("sends the answers with the session's id and model, then thanks the student", async () => {
    await endAfterTalking();
    const sent = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", sent);
    await userEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await userEvent.click(screen.getByRole("radio", { name: "4" }));
    await userEvent.type(screen.getByLabelText(/Anything else/), "Very clear");
    await userEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    expect(await screen.findByText("Thanks for your feedback.")).toBeInTheDocument();
    const [url, init] = sent.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/feedback");
    expect(JSON.parse(init.body as string)).toEqual({
      helpful: "yes",
      rating: 4,
      comment: "Very clear",
      model: "Deer Population",
      conversation_id: "conv_test",
      turns: 1,
    });
    vi.unstubAllGlobals();
    mockServer();
    mockMic();
  });

  it("says so if sending fails, and No thanks hides it", async () => {
    await endAfterTalking();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false }) as Response));
    await userEvent.click(screen.getByRole("radio", { name: "No" }));
    await userEvent.click(screen.getByRole("button", { name: "Send feedback" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t be sent/);
    await userEvent.click(screen.getByRole("button", { name: "No thanks" }));
    expect(screen.queryByRole("form", { name: "How was this session?" })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
    mockServer();
    mockMic();
  });

  it("goes away when a new conversation starts", async () => {
    await endAfterTalking();
    await userEvent.click(screen.getByRole("button", { name: "New conversation" }));
    expect(screen.queryByRole("form", { name: "How was this session?" })).not.toBeInTheDocument();
  });
});
