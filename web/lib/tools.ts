// Tool handlers: each looks at the student's loaded model and answers from the graph engine.
import type { ModelGraph, ToolResult } from "./engine";
import { TOOL_SPECS } from "./tool-specs";

type Args = Record<string, string>;

const RUNNERS: Record<string, (m: ModelGraph, a: Args) => ToolResult> = {
  get_overview: (m) => m.overview(),
  get_variable: (m, a) => m.variable(a.name),
  get_loop: (m, a) => m.loop(a.query),
  find_path: (m, a) => m.path(a.from_name, a.to_name),
  get_behavior: (m) => m.behavior(),
  get_layout: (m) => m.layout(),
  name_loop: (m, a) => m.nameLoop(a.loop_id, a.nickname),
};

/** What the page lets tools change outside the model. */
export interface PageHooks {
  setTheme?: (mode: "light" | "dark") => void;
  /** Called after a tool changed the model (a loop nickname), so the page can redraw. */
  onModelChange?: () => void;
}

/** Tools that act on the page, not the model, so they work before a model is loaded. */
function runPageTool(name: string, args: Args, hooks: PageHooks): ToolResult | undefined {
  if (name !== "set_theme") return undefined;
  const mode = args.mode.toLowerCase().trim();
  if (mode !== "light" && mode !== "dark") return { error: "Say either light or dark." };
  if (!hooks.setTheme) return { error: "The page can't change its theme right now." };
  hooks.setTheme(mode);
  return { done: true, mode, message: `The page is now in ${mode} mode.` };
}

export const TOOL_NAMES = TOOL_SPECS.map((t) => t.name);

export const NO_MODEL: ToolResult = {
  error:
    "No model has been loaded yet. Ask the student to upload their model file with the upload button on the page, then try again.",
};

/** Answer one tool call. Problems come back as an `error` the agent can speak, never as a crash. */
export function runTool(model: ModelGraph | null, name: string, args: unknown, hooks: PageHooks = {}): ToolResult {
  const spec = TOOL_SPECS.find((t) => t.name === name);
  if (!spec) return { error: `Unknown tool '${name}'.` };
  if (!model && name !== "set_theme") return NO_MODEL;
  const given = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const missing = Object.keys(spec.params).filter((p) => typeof given[p] !== "string" || !(given[p] as string).trim());
  if (missing.length) return { error: `Missing ${missing.join(" and ")}. Ask the student what they mean.` };
  const page = runPageTool(name, given as Args, hooks);
  if (page) return page;
  const result = RUNNERS[name](model!, given as Args);
  if (name === "name_loop" && result.saved) hooks.onModelChange?.();
  return result;
}

/** Handlers in the shape the ElevenLabs SDK wants: name -> (parameters) => string. */
export function clientToolsFor(getModel: () => ModelGraph | null, hooks: PageHooks = {}) {
  return Object.fromEntries(
    TOOL_NAMES.map((name) => [name, (args: unknown) => JSON.stringify(runTool(getModel(), name, args, hooks))]),
  );
}
