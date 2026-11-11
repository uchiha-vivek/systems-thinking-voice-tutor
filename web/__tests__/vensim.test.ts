// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { ModelGraph } from "@/lib/engine";
import { parseVensim, VensimError } from "@/lib/vensim";
import { TINY_SIR_MDL } from "./fixtures/tiny-sir-mdl";

const data = parseVensim(TINY_SIR_MDL);
const model = new ModelGraph(data);
const byLabel = (label: string) => data.variables.find((v) => v.label === label)!;
const link = (from: string, to: string) => data.links.find((l) => l.from === from && l.to === to)!;

describe("reading a Vensim file", () => {
  it("reads the title, variables and kinds, leaving out the time settings", () => {
    expect(data.title).toBe("Tiny SIR model");
    expect(data.id).toBe("tiny-sir-model");
    expect(data.source).toBe("an uploaded Vensim file");
    expect(data.variables.map((v) => [v.label, v.kind])).toEqual([
      ["Susceptible Population letter S", "stock"],
      ["Infected Population letter I", "stock"],
      ["Infection Rate", "flow"],
      ["Recovery Rate", "flow"],
      ["Contact Rate", "variable"],
      ["Total Population letter N", "variable"],
      ["Recovery Time", "variable"],
      ["Crowding Effect", "variable"],
      ["Distancing Lookup", "variable"],
      ["Distancing", "variable"],
    ]);
    expect(byLabel("Infected Population letter I").aliases).toEqual(["Infected Population I"]);
  });

  it("keeps the author's comment, units and constants", () => {
    expect(byLabel("Susceptible Population letter S").description).toBe("People who can still catch it.");
    expect(byLabel("Susceptible Population letter S").units).toBe("People");
    expect(byLabel("Crowding Effect").units).toBe("dimensionless");
    expect(byLabel("Contact Rate").value).toBe(0.5);
    expect(byLabel("Infected Population letter I").value).toBe(1);
    expect(byLabel("Susceptible Population letter S").equation).toBe("Total Population letter N minus 1");
  });

  it("records which flows fill and drain each stock", () => {
    expect(byLabel("Infected Population letter I").inflows).toEqual(["Infection Rate"]);
    expect(byLabel("Infected Population letter I").outflows).toEqual(["Recovery Rate"]);
    expect(byLabel("Susceptible Population letter S").outflows).toEqual(["Infection Rate"]);
  });

  it("joins lines that end in a backslash and says the equation in words", () => {
    expect(byLabel("Infection Rate").equation).toBe(
      "Contact Rate times Susceptible Population letter S times Infected Population letter I divided by Total Population letter N",
    );
  });

  it("describes lookups in words", () => {
    expect(byLabel("Crowding Effect").equation).toBe(
      "a lookup table applied to Infected Population letter I; the table falls as its input grows",
    );
    expect(byLabel("Distancing Lookup").equation).toBe("a lookup table that rises as its input grows");
    expect(byLabel("Distancing").equation).toMatch(
      /^if .* then the lookup table Distancing Lookup applied to Infected Population letter I divided by Total Population letter N otherwise 0$/,
    );
  });

  it("collects text notes and the run length", () => {
    expect(data.notes).toEqual(["Adapted from a classroom example", "The model runs from 0 to 50 Day."]);
    expect(data.behavior_graphs).toBeUndefined();
    expect(data.caveats).toBeUndefined();
  });
});

describe("link directions", () => {
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
    expect(link("infected_population_i", "distancing").polarity).toBe("+");
    expect(link("total_population_n", "distancing").polarity).toBe("-");
  });

  it("does not turn a stock's starting value into a feedback link", () => {
    expect(data.links.some((l) => l.from === "total_population_n" && l.to === "susceptible_population_s")).toBe(false);
  });

  it("uses the author's own +/- mark on a drawn arrow", () => {
    const random = parseVensim(
      TINY_SIR_MDL.replace('Infected Population I/"Recovery Time"', "RANDOM UNIFORM(Infected Population I, Recovery Time, 1)"),
    );
    const l = (from: string, to: string) => random.links.find((x) => x.from === from && x.to === to)!;
    expect(l("recovery_time", "recovery_rate").polarity).toBe("-"); // marked "-" on the drawing
    expect(l("infected_population_i", "recovery_rate").polarity).toBe("?"); // unmarked, and RANDOM can't tell
  });
});

describe("the loops it finds", () => {
  it("finds the infection loop as reinforcing and the two drains as balancing", () => {
    expect(model.loops).toHaveLength(3);
    expect(model.loops.map((l) => l.type).sort()).toEqual(["B", "B", "R"]);
    expect(model.loops.find((l) => l.type === "R")!.variables.sort()).toEqual(["infected_population_i", "infection_rate"]);
  });

  it("walks the reinforcing loop step by step in words", () => {
    const r = model.loop("R1") as { steps_in_order: string[]; what_it_means: string };
    expect(r.steps_in_order).toEqual([
      "When Infected Population letter I goes up, Infection Rate goes up.",
      "When Infection Rate goes up, Infected Population letter I fills faster.",
    ]);
    expect(r.what_it_means).toMatch(/reinforcing/);
  });

  it("the overview describes stocks, flows and loop counts", () => {
    expect(model.overview()).toMatchObject({
      title: "Tiny SIR model",
      source: "an uploaded Vensim file",
      stocks: ["Susceptible Population letter S", "Infected Population letter I"],
      flows: ["Infection Rate", "Recovery Rate"],
      number_of_loops: 3,
      loop_counts: { reinforcing: 1, balancing: 2, unclear: 0 },
    });
  });
});

describe("the drawn diagram", () => {
  const d = data.diagram!;

  it("draws stocks, valves and variables with their ids", () => {
    const shape = (id: string) => d.shapes.find((s) => s.id === id)!;
    expect(shape("susceptible_population_s")).toMatchObject({ kind: "stock", x: 300, y: 200, w: 80, h: 40, labelSide: "center" });
    expect(shape("infection_rate")).toMatchObject({ kind: "valve", x: 450, y: 200, label: ["Infection Rate"], labelSide: "bottom" });
    expect(shape("contact_rate")).toMatchObject({ kind: "aux", labelSide: "bottom" });
    // The second Contact Rate is a shadow copy, drawn as an alias with no id.
    expect(d.shapes.filter((s) => s.kind === "alias").map((s) => [s.label, s.id])).toEqual([[["Contact Rate"], undefined]]);
  });

  it("draws pipes from stock to stock and into a cloud", () => {
    expect(d.pipes).toHaveLength(2);
    expect(d.pipes[0]).toMatchObject({ cloudStart: false, cloudEnd: false });
    expect(d.pipes[0].points[0]).toEqual([340, 200]); // leaves the right edge of Susceptible
    expect(d.pipes[0].points.at(-1)).toEqual([560, 200]); // enters the left edge of Infected
    expect(d.pipes[1]).toMatchObject({ cloudStart: false, cloudEnd: true });
    expect(d.pipes[1].points.at(-1)).toEqual([820, 200]);
  });

  it("draws arrows with the link's direction", () => {
    expect(d.arrows).toHaveLength(7);
    expect(d.arrows.map((a) => a.polarity)).toEqual(["+", "-", "+", "+", "+", "-", "-"]);
  });

  it("reads loop markers and says where things are", () => {
    expect(d.loops.map((l) => l.text)).toEqual(["R", "B"]);
    expect(d.box.every(Number.isFinite)).toBe(true);
    expect(data.layout_description).toMatch(/^Positions as drawn in the file\. Susceptible Population S is on the left\./);
    expect(data.layout_description).toMatch(/a reinforcing loop marker, labeled R/i);
  });
});

describe("files it refuses", () => {
  it("rejects text that is not a Vensim model", () => {
    expect(() => parseVensim("hello")).toThrow(VensimError);
    expect(() => parseVensim("hello")).toThrow("That file is not a Vensim model. Upload a file that ends in .mdl.");
    expect(() => parseVensim("<xmile><model/></xmile>")).toThrow(/not a Vensim model/);
  });

  it("rejects subscripted models instead of misreading them", () => {
    const range = TINY_SIR_MDL.replace("Contact Rate=\n", "Region: North, South\n\t~\t~\t|\n\nContact Rate=\n");
    expect(() => parseVensim(range)).toThrow(/subscripts are not supported/);
    const used = TINY_SIR_MDL.replace("Contact Rate*Susceptible", "Contact Rate[North]*Susceptible");
    expect(() => parseVensim(used)).toThrow(VensimError);
  });

  it("rejects a model with only the time settings", () => {
    const empty = TINY_SIR_MDL.slice(TINY_SIR_MDL.indexOf("****"));
    expect(() => parseVensim(empty)).toThrow(/no variables/);
  });
});

describe("Vensim equation details", () => {
  it("marks unreadable equations as unclear and warns", () => {
    const odd = parseVensim(TINY_SIR_MDL.replace("Infected Population I/\"Recovery Time\"", "Infected Population I / 'Recovery Time'"));
    expect(odd.caveats?.[0]).toMatch(/could not be read/);
    expect(odd.links.find((l) => l.from === "infected_population_i" && l.to === "recovery_rate")!.polarity).toBe("?");
  });

  it("treats A FUNCTION OF as unclear links from the names listed", () => {
    const sketchy = parseVensim(TINY_SIR_MDL.replace('Infected Population I/"Recovery Time"', "A FUNCTION OF(Infected Population I, Recovery Time)"));
    expect(sketchy.links.find((l) => l.from === "infected_population_i" && l.to === "recovery_rate")!.polarity).toBe("?");
    expect(sketchy.caveats?.[0]).toMatch(/only sketched/);
  });

  it("reads XIDZ, SMOOTH and MIN through to their inputs", () => {
    const m = parseVensim(
      TINY_SIR_MDL.replace('Infected Population I/"Recovery Time"', "SMOOTH(MIN(XIDZ(Infected Population I, Recovery Time, 0), 100), 2)"),
    );
    expect(m.links.find((l) => l.from === "infected_population_i" && l.to === "recovery_rate")!.polarity).toBe("+");
  });
});
