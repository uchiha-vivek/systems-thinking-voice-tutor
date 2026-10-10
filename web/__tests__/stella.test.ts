// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ModelGraph } from "@/lib/engine";
import { parseStella, StellaError } from "@/lib/stella";
import { TINY_SIR } from "./fixtures/tiny-sir";

const data = parseStella(TINY_SIR);
const model = new ModelGraph(data);
const byLabel = (label: string) => data.variables.find((v) => v.label === label)!;

describe("reading a Stella file", () => {
  it("reads the title, variables and kinds", () => {
    expect(data.title).toBe("Tiny SIR model");
    expect(data.id).toBe("tiny-sir-model");
    expect(data.variables.map((v) => [v.label, v.kind])).toEqual([
      ["Susceptible Population S", "stock"],
      ["Infected Population I", "stock"],
      ["Infection Rate", "flow"],
      ["Recovery Rate", "flow"],
      ["Contact Rate", "variable"],
      ["Total Population N", "variable"],
      ["Recovery Time", "variable"],
      ["Crowding Effect", "variable"],
    ]);
  });

  it("keeps the author's description, units and constants", () => {
    expect(byLabel("Susceptible Population S").description).toBe("People who can still catch it.");
    expect(byLabel("Susceptible Population S").units).toBe("People");
    expect(byLabel("Contact Rate").value).toBe(0.5);
    expect(byLabel("Infected Population I").value).toBe(1);
  });

  it("records which flows fill and drain each stock", () => {
    expect(byLabel("Infected Population I").inflows).toEqual(["Infection Rate"]);
    expect(byLabel("Infected Population I").outflows).toEqual(["Recovery Rate"]);
  });

  it("says how a flow is calculated, in words", () => {
    expect(byLabel("Infection Rate").equation).toBe(
      "Contact Rate times Susceptible Population S times Infected Population I divided by Total Population N",
    );
  });

  it("collects notes, the run length and the graphs the author set up", () => {
    expect(data.notes).toEqual(["Adapted from a classroom example", "The model runs from 0 to 50 Days."]);
    expect(data.behavior_graphs).toEqual([{ title: "Graph 1", series: ["Infected Population I", "Susceptible Population S"] }]);
  });
});

describe("link directions", () => {
  const link = (from: string, to: string) => data.links.find((l) => l.from === from && l.to === to)!;

  it("flows into a stock add to it, flows out drain it", () => {
    expect(link("infection_rate", "infected_population_i")).toMatchObject({ polarity: "+", kind: "inflow" });
    expect(link("infection_rate", "susceptible_population_s")).toMatchObject({ polarity: "-", kind: "outflow" });
    expect(link("recovery_rate", "infected_population_i")).toMatchObject({ polarity: "-", kind: "outflow" });
  });

  it("works directions out of the equations", () => {
    expect(link("contact_rate", "infection_rate").polarity).toBe("+");
    expect(link("susceptible_population_s", "infection_rate").polarity).toBe("+");
    expect(link("total_population_n", "infection_rate").polarity).toBe("-");
    expect(link("infected_population_i", "recovery_rate").polarity).toBe("+");
  });

  it("combines a lookup table's direction with the input's", () => {
    expect(link("infected_population_i", "crowding_effect").polarity).toBe("-");
  });

  it("uses the author's own mark and reasoning on a drawn connector", () => {
    expect(link("recovery_time", "recovery_rate")).toMatchObject({
      polarity: "-",
      reasoning: "A longer recovery time means people recover more slowly.",
    });
  });

  it("does not turn a stock's starting value into a feedback link", () => {
    expect(data.links.some((l) => l.from === "infected_population_i" && l.to === "susceptible_population_s")).toBe(false);
  });
});

describe("the loops it finds", () => {
  it("finds the infection loop as reinforcing and the two drains as balancing", () => {
    const byId = Object.fromEntries(model.loops.map((l) => [l.id, l.type]));
    expect(model.loops).toHaveLength(3);
    expect(Object.values(byId).sort()).toEqual(["B", "B", "R"]);
    expect(model.loops.find((l) => l.type === "R")!.variables.sort()).toEqual(["infected_population_i", "infection_rate"]);
  });

  it("uses flow wording when describing a stock", () => {
    const r = model.variable("infected population") as { affected_by: { variable: string; effect: string }[] };
    expect(r.affected_by.find((a) => a.variable === "Infection Rate")!.effect).toBe(
      "When Infection Rate goes up, Infected Population I fills faster.",
    );
    expect(r.affected_by.find((a) => a.variable === "Recovery Rate")!.effect).toBe(
      "When Recovery Rate goes up, Infected Population I drains faster.",
    );
  });

  it("answers path questions through the stocks", () => {
    const r = model.path("contact rate", "infected population") as { connected: boolean; paths: { overall: string }[] };
    expect(r.connected).toBe(true);
    expect(r.paths[0].overall).toBe("If Contact Rate goes up, Infected Population I goes up through this chain.");
  });

  it("the overview describes stocks, flows and loop counts", () => {
    const ov = model.overview() as Record<string, unknown>;
    expect(ov).toMatchObject({
      title: "Tiny SIR model",
      source: "an uploaded Stella file",
      stocks: ["Susceptible Population S", "Infected Population I"],
      flows: ["Infection Rate", "Recovery Rate"],
      number_of_loops: 3,
      loop_counts: { reinforcing: 1, balancing: 2, unclear: 0 },
      verified_by_instructor: null,
    });
    expect(ov.caveats).toBeUndefined();
  });

  it("says plainly that the file has no simulation results", () => {
    expect((model.behavior() as { note: string }).note).toMatch(/not the results of a simulation/);
  });

  it("describes a variable's setting and starting value", () => {
    expect(model.variable("contact rate")).toMatchObject({ set_to: 0.5, kind: "variable" });
    expect(model.variable("infected population")).toMatchObject({ starting_value: 1, flows_in: ["Infection Rate"], flows_out: ["Recovery Rate"] });
  });
});

describe("unclear directions are reported, not guessed", () => {
  const unclear = parseStella(
    TINY_SIR.replace("<eqn>Infected_Population_I/Recovery_Time</eqn>", "<eqn>RANDOM(Infected_Population_I, Recovery_Time)</eqn>"),
  );

  it("marks them with ? and warns in the overview", () => {
    expect(unclear.links.find((l) => l.from === "recovery_time")!.polarity).toBe("-"); // the author marked this one
    expect(unclear.links.find((l) => l.from === "infected_population_i" && l.to === "recovery_rate")!.polarity).toBe("?");
    const ov = new ModelGraph(unclear).overview() as { caveats: string[] };
    expect(ov.caveats[0]).toMatch(/1 of the \d+ links have a direction that could not be worked out/);
  });

  it("a loop through an unclear link has an unknown type", () => {
    expect(new ModelGraph(unclear).loops.some((l) => l.type === "?")).toBe(true);
  });
});

describe("files it refuses", () => {
  it("rejects text that is not XML", () => {
    expect(() => parseStella("hello")).toThrow(StellaError);
  });

  it("rejects XML that is not a Stella model", () => {
    expect(() => parseStella("<html><body/></html>")).toThrow(/not a Stella model/);
  });

  it("rejects a model with no variables", () => {
    expect(() => parseStella(TINY_SIR.replace(/<variables>[\s\S]*<\/variables>/, "<variables/>"))).toThrow(/no variables/);
  });

  it("rejects arrayed models instead of misreading them", () => {
    const arrayed = TINY_SIR.replace('<aux name="Contact Rate">', '<aux name="Contact Rate"><dimensions><dim name="Region"/></dimensions>');
    expect(() => parseStella(arrayed)).toThrow(/arrays/);
  });
});
