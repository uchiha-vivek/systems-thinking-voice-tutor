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
};

export const TOOL_NAMES = TOOL_SPECS.map((t) => t.name);

export const NO_MODEL: ToolResult = {
  error:
    "No model has been loaded yet. Ask the student to upload their Stella file with the upload button on the page, then try again.",
};

/** Answer one tool call. Problems come back as an `error` the agent can speak, never as a crash. */
export function runTool(model: ModelGraph | null, name: string, args: unknown): ToolResult {
  const spec = TOOL_SPECS.find((t) => t.name === name);
  if (!spec) return { error: `Unknown tool '${name}'.` };
  if (!model) return NO_MODEL;
  const given = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;
  const missing = Object.keys(spec.params).filter((p) => typeof given[p] !== "string" || !(given[p] as string).trim());
  if (missing.length) return { error: `Missing ${missing.join(" and ")}. Ask the student what they mean.` };
  return RUNNERS[name](model, given as Args);
}

/** Handlers in the shape the ElevenLabs SDK wants: name -> (parameters) => string. */
export function clientToolsFor(getModel: () => ModelGraph | null) {
  return Object.fromEntries(
    TOOL_NAMES.map((name) => [name, (args: unknown) => JSON.stringify(runTool(getModel(), name, args))]),
  );
}
