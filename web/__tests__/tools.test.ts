// @vitest-environment node
// Every tool, called the way the agent calls it, against the built-in example models.
import { describe, expect, it } from "vitest";
import { MODELS } from "@/lib/models";
import { clientToolsFor, NO_MODEL, runTool, TOOL_NAMES } from "@/lib/tools";
import { TOOL_SPECS } from "@/lib/tool-specs";

const deer = MODELS.get("deer-population")!;
const water = MODELS.get("water-supply")!;

type R = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const call = (model: typeof deer | null, name: string, args: unknown = {}) => runTool(model, name, args) as R;

describe("tool plumbing", () => {
  it("serves exactly the six tools", () => {
    expect([...TOOL_NAMES].sort()).toEqual(
      ["find_path", "get_behavior", "get_layout", "get_loop", "get_overview", "get_variable"].sort(),
    );
  });

  it("answers with an error the agent can speak when no model is loaded", () => {
    for (const name of TOOL_NAMES) expect(runTool(null, name, { name: "x", query: "x", from_name: "x", to_name: "x" })).toBe(NO_MODEL);
  });

  it("asks for a missing or blank parameter instead of crashing", () => {
    expect(call(deer, "get_variable", {}).error).toMatch(/Missing name/);
    expect(call(deer, "get_variable", { name: "   " }).error).toMatch(/Missing name/);
    expect(call(deer, "find_path", { from_name: "births" }).error).toMatch(/Missing to_name/);
    expect(call(deer, "get_loop", null).error).toMatch(/Missing query/);
  });

  it("rejects an unknown tool", () => {
    expect(call(deer, "get_nothing").error).toMatch(/Unknown tool/);
  });

  it("every tool is defined with described string parameters", () => {
    for (const spec of TOOL_SPECS) {
      expect(spec.description).toBeTruthy();
      for (const d of Object.values(spec.params)) expect(d).toBeTruthy();
      expect(spec.params).not.toHaveProperty("model_id");
    }
  });
});

describe("client tools for the ElevenLabs SDK", () => {
  it("return JSON text, and follow whichever model is loaded right now", () => {
    let current: typeof deer | null = null;
    const tools = clientToolsFor(() => current);
    expect(JSON.parse(tools.get_overview({}) as string).error).toMatch(/No model has been loaded/);
    current = deer;
    expect(JSON.parse(tools.get_overview({}) as string).title).toBe("Deer Population");
    current = water;
    expect(JSON.parse(tools.get_overview({}) as string).title).toBe("Formal and Informal Water Supply");
  });
});

describe("deer population", () => {
  it("overview", () => {
    const r = call(deer, "get_overview");
    expect(r.title).toBe("Deer Population");
    expect(r.verified_by_instructor).toBe(true);
    expect(r.loops.map((l: { type: string }) => l.type).sort()).toEqual(["balancing", "reinforcing"]);
    expect(r.has_behavior_over_time_graph).toBe(true);
  });

  it("walks through the reinforcing loop", () => {
    const r = call(deer, "get_loop", { query: "walk me through the reinforcing loop" });
    expect(r.type).toBe("reinforcing");
    expect(r.steps_in_order).toEqual([
      "When Deer population goes up, Deer births per year goes up.",
      "When Deer births per year goes up, Deer population goes up.",
    ]);
    expect(r.closes_back_to).toBe("Deer population");
  });

  it("the balancing loop pushes back", () => {
    const r = call(deer, "get_loop", { query: "the deaths loop" });
    expect(r.type).toBe("balancing");
    expect(r.steps_in_order).toContain("When Deer deaths per year goes up, Deer population goes down.");
  });

  it("what affects deer population", () => {
    const r = call(deer, "get_variable", { name: "deer population" });
    const effects = Object.fromEntries(r.affected_by.map((a: { variable: string; effect: string }) => [a.variable, a.effect]));
    expect(effects["Deer births per year"]).toMatch(/Deer population goes up\.$/);
    expect(effects["Deer deaths per year"]).toMatch(/Deer population goes down\.$/);
  });

  it("births up means deaths up", () => {
    const r = call(deer, "find_path", { from_name: "births", to_name: "deaths" });
    expect(r.connected).toBe(true);
    expect(r.paths[0].chain).toEqual(["Deer births per year", "Deer population", "Deer deaths per year"]);
    expect(r.paths[0].overall).toContain("Deer deaths per year goes up");
  });

  it("behavior over time", () => {
    expect(call(deer, "get_behavior").graphs[0].key_insight).toContain("Births stay ahead of deaths");
  });

  it("layout says the balancing loop is on the right", () => {
    expect(call(deer, "get_layout").layout).toContain("right with the balancing loop");
  });

  it("an unknown variable lists the real ones", () => {
    const r = call(deer, "get_variable", { name: "wolves" });
    expect(r.error).toBeTruthy();
    expect(r.available_variables).toEqual(["Deer population", "Deer births per year", "Deer deaths per year"]);
  });

  it("a variable asked about itself gets a clear answer, not a one-step path", () => {
    expect(call(deer, "find_path", { from_name: "deer", to_name: "deer population" }).same_variable).toBe(true);
  });
});

describe("water supply", () => {
  it("overview flags unverified and five loops", () => {
    const r = call(water, "get_overview");
    expect(r.verified_by_instructor).toBe(false);
    expect(r.loops).toHaveLength(5);
  });

  it("'demand' is ambiguous", () => {
    const r = call(water, "get_variable", { name: "demand" });
    expect(r.ambiguous).toBe(true);
    expect(new Set(r.ask_student_which_one)).toEqual(new Set(["Informal demand", "Formal demand"]));
  });

  it("B three point one", () => {
    const r = call(water, "get_loop", { query: "walk me through B three point one" });
    expect(r.id).toBe("B3.1");
    expect(r.type).toBe("balancing");
    expect(r.variables).toEqual(["Informal demand", "Total expenditure on water supply per household", "Household income"]);
  });

  it("informal demand up means income down", () => {
    const r = call(water, "find_path", { from_name: "informal demand", to_name: "household income" });
    expect(r.paths[0].overall).toContain("Household income goes down");
  });

  it("speaks the delay in the rehab loop", () => {
    const r = call(water, "get_loop", { query: "B four point one" });
    expect(r.steps_in_order.some((s: string) => s.includes("This takes time (delay)."))).toBe(true);
  });

  it("has no layout and says so", () => {
    expect(call(water, "get_layout").layout).toBe("No layout information was recorded for this diagram.");
  });

  it("unconnected variables", () => {
    expect(call(water, "find_path", { from_name: "household income", to_name: "population" }).connected).toBe(false);
  });

  it("lists loops in the same order every time", () => {
    expect(call(water, "get_overview").loops.map((l: { id: string }) => l.id)).toEqual(["R3.1", "B3.1", "B3.2", "B2.1", "B4.1"]);
  });
});
