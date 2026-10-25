// @vitest-environment jsdom
// Reading diagram positions from a Stella file, and the connector curves.
import { describe, expect, it } from "vitest";

import { arcPoints } from "@/lib/diagram";
import { ModelGraph } from "@/lib/engine";
import { parseStella } from "@/lib/stella";
import { DRAWN_MODEL } from "./fixtures/drawn-model";
import { TINY_SIR } from "./fixtures/tiny-sir";

const model = parseStella(DRAWN_MODEL);
const diagram = model.diagram!;
const shape = (label: string, kind?: string) =>
  diagram.shapes.find((s) => s.label.join(" ") === label && (!kind || s.kind === kind))!;

describe("arcPoints", () => {
  it("is a straight line when the file gives no angle", () => {
    const pts = arcPoints([0, 0], [100, 0], undefined);
    expect(pts[0]).toEqual([0, 0]);
    expect(pts[pts.length - 1]).toEqual([100, 0]);
    expect(pts.every(([, y]) => y === 0)).toBe(true);
  });

  it("leaves in the file's direction and ends at the target", () => {
    // 90 degrees is straight up in the file, which is up the screen (smaller y).
    const pts = arcPoints([0, 0], [100, 0], 90);
    expect(pts[1][1]).toBeLessThan(0);
    expect(pts[pts.length - 1][0]).toBeCloseTo(100);
    expect(pts[pts.length - 1][1]).toBeCloseTo(0);
  });
});

describe("parseDiagram", () => {
  it("uses the top-left corner when a shape has a size, the center when not", () => {
    expect(shape("Population")).toMatchObject({ kind: "stock", x: 125, y: 120, w: 50, h: 40 });
    expect(shape("Deaths")).toMatchObject({ kind: "valve", x: 210, y: 120 });
    expect(shape("Lifetime", "alias")).toMatchObject({ x: 210, y: 200 });
  });

  it("splits multi-line names into label lines", () => {
    expect(diagram.shapes.find((s) => s.label[0] === "Birth")!.label).toEqual(["Birth", "Rate"]);
  });

  it("marks pipe ends that don't touch a stock as clouds", () => {
    expect(diagram.pipes.map((p) => [p.cloudStart, p.cloudEnd])).toEqual([
      [true, false], // births come from a cloud into Population
      [false, true], // deaths drain Population into a cloud
    ]);
  });

  it("draws each connector, including one from an alias, with the engine's polarity", () => {
    expect(diagram.arrows).toHaveLength(3);
    expect(diagram.arrows.map((a) => a.polarity)).toEqual(["+", "+", "-"]);
    const graph = new ModelGraph(model);
    // The drawn sign matches what the tutor says out loud.
    const deaths = graph.variable("Deaths") as { affected_by: { variable: string; effect: string }[] };
    expect(deaths.affected_by.find((x) => x.variable === "Lifetime")!.effect).toBe("When Lifetime goes up, Deaths goes down.");
  });

  it("starts and ends arrows at the edge of their shapes, not the center", () => {
    const fromPopulation = diagram.arrows[1].points;
    const [x, y] = fromPopulation[0];
    expect(Math.abs(x - 125) > 25 || Math.abs(y - 120) > 20).toBe(true);
  });

  it("reads the author's loop markers", () => {
    expect(diagram.loops).toEqual([{ x: 70, y: 150, r: 15, text: "R", name: "Growth Loop" }]);
  });

  it("describes where things are, for the tutor's layout tool", () => {
    expect(model.layout_description).toMatch(/Population is in the middle/);
    expect(model.layout_description).toMatch(/reinforcing loop marker named Growth Loop, labeled R/);
    expect(new ModelGraph(model).layout()).toEqual({ layout: model.layout_description });
  });

  it("has no diagram when the file saves no positions", () => {
    const plain = parseStella(TINY_SIR);
    expect(plain.diagram).toBeUndefined();
    expect(plain.layout_description).toBeUndefined();
  });
});
