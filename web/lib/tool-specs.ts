// The tools the ElevenLabs agent can call. They run in the student's browser (as ElevenLabs
// "client tools") against the model the student uploaded, so no tool needs a model id.
// set_theme acts on the page itself and works even with no model loaded.
// This file is the single source of truth: the page registers handlers for these names, and
// scripts/setup-agent.ts registers the same names and parameters with ElevenLabs.
// Keep it free of imports so the setup script can load it on its own.

export interface ToolSpec {
  name: string;
  description: string;
  /** Parameter name -> description. Every parameter is a required string. */
  params: Record<string, string>;
}

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: "get_overview",
    description:
      "Get the model's title, summary, stocks and flows, loops, key variables, and anything the student should be warned about. Call this first and for any overview question.",
    params: {},
  },
  {
    name: "get_variable",
    description:
      "Get what affects a variable and what it affects, with the direction of each effect, how it is calculated, and which loops it belongs to. Use for 'what connects to X', 'what affects X', 'what is X'.",
    params: { name: "The variable name exactly as the student said it." },
  },
  {
    name: "get_loop",
    description:
      "Get one feedback loop's steps in order, its type and its meaning. Use for 'walk me through' and 'explain the loop'.",
    params: {
      query: "The loop as the student described it, e.g. 'reinforcing loop', 'B three point one', 'R2', 'the loop through infected population'.",
    },
  },
  {
    name: "find_path",
    description:
      "Find how one variable affects another through chains of links, and the overall effect. Use for 'if X goes up, what happens to Y'.",
    params: {
      from_name: "The variable that changes first.",
      to_name: "The variable whose response the student is asking about.",
    },
  },
  {
    name: "get_behavior",
    description:
      "Get the behavior-over-time graphs the model's author set up, described in words. Use for 'what happens over time' and 'what does the graph show'.",
    params: {},
  },
  {
    name: "name_loop",
    description:
      "Save the short nickname you gave a loop, so it is shown next to the loop's number on the page and the student can ask for it by that name. Call it whenever you give a loop a nickname.",
    params: {
      loop_id: "The loop's id as a tool gave it, e.g. 'R1' or 'B2'.",
      nickname: "A short plain name built from the loop's variables, e.g. 'infection spread loop'.",
    },
  },
  {
    name: "set_theme",
    description:
      "Switch the web page between light mode and dark mode. Use when the student asks for dark mode, light mode, a darker or brighter screen, or less glare.",
    params: { mode: "Either 'light' or 'dark'." },
  },
  {
    name: "get_layout",
    description:
      "Get where things are positioned on the diagram. Use ONLY when the student asks where something is or what it looks like.",
    params: {},
  },
];
