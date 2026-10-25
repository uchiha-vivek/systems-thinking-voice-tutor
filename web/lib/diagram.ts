// Reads where things are drawn in a Stella (.stmx) file's stock-and-flow view, so the page can
// draw the diagram for students who can see it, and the tutor can say where things are.
//
// Stella's rules: a shape with a width or height has x, y at its top-left corner; one without has
// x, y at its center and the default size. A connector's "angle" is the direction it leaves its
// start, in degrees counterclockwise from pointing right, and the connector is a circular arc.

export type Point = [number, number];
type Polarity = "+" | "-" | "?";

export interface Shape {
  kind: "stock" | "aux" | "valve" | "alias";
  /** Center. */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string[];
  labelSide: "center" | "top" | "bottom" | "left" | "right";
}

export interface Diagram {
  /** minX, minY, width, height of everything drawn, with a margin. */
  box: [number, number, number, number];
  shapes: Shape[];
  pipes: { points: Point[]; cloudStart: boolean; cloudEnd: boolean }[];
  arrows: { points: Point[]; polarity?: Polarity }[];
  loops: { x: number; y: number; r: number; text: string; name?: string }[];
}

interface Lookups {
  /** Equation name as written in the file -> variable id, or undefined if unknown. */
  idOf: (name: string) => string | undefined;
  /** The direction of the link a -> b, as the engine will report it. */
  polarityOf: (from: string, to: string) => Polarity | undefined;
}

const STOCK_SIZE: Point = [45, 35];
const MARGIN = 40;

const children = (el: Element, name: string) => [...el.children].filter((c) => c.localName === name);
const child = (el: Element, name: string) => children(el, name)[0];
const num = (el: Element, attr: string) => {
  const v = el.getAttribute(attr);
  return v === null || v === "" ? undefined : Number(v);
};
const SIDES = new Set(["center", "top", "bottom", "left", "right"]);

/** Center and size, following Stella's top-left-if-sized rule. */
function place(el: Element, size: Point): { x: number; y: number; w: number; h: number } | undefined {
  const x = num(el, "x");
  const y = num(el, "y");
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const w = num(el, "width");
  const h = num(el, "height");
  if (w === undefined && h === undefined) return { x, y, w: size[0], h: size[1] };
  const ww = w ?? size[0];
  const hh = h ?? size[1];
  return { x: x + ww / 2, y: y + hh / 2, w: ww, h: hh };
}

/** True when p is inside the shape, plus a little padding so arrows stop just short of it. */
function inside(s: Shape, [px, py]: Point, pad = 3): boolean {
  if (s.kind === "stock") return Math.abs(px - s.x) <= s.w / 2 + pad && Math.abs(py - s.y) <= s.h / 2 + pad;
  return Math.hypot(px - s.x, py - s.y) <= Math.max(s.w, s.h) / 2 + pad;
}

/** Points along the circular arc that leaves `a` heading at `angleDeg` and ends at `b`. */
export function arcPoints(a: Point, b: Point, angleDeg: number | undefined, steps = 48): Point[] {
  const d: Point = [b[0] - a[0], b[1] - a[1]];
  const len2 = d[0] * d[0] + d[1] * d[1];
  if (angleDeg === undefined || !Number.isFinite(angleDeg) || len2 === 0) return line(a, b, steps);
  const rad = (angleDeg * Math.PI) / 180;
  const t: Point = [Math.cos(rad), -Math.sin(rad)]; // the file's y points up; the screen's points down
  const n: Point = [-t[1], t[0]];
  const nd = n[0] * d[0] + n[1] * d[1];
  if (Math.abs(nd) < 1e-6 * Math.sqrt(len2)) return line(a, b, steps);
  const s = len2 / (2 * nd);
  const c: Point = [a[0] + s * n[0], a[1] + s * n[1]];
  const a0 = Math.atan2(a[1] - c[1], a[0] - c[0]);
  const a1 = Math.atan2(b[1] - c[1], b[0] - c[0]);
  // Go round the circle the way the start direction points.
  const dir = Math.sign((a[0] - c[0]) * t[1] - (a[1] - c[1]) * t[0]) || 1;
  let sweep = a1 - a0;
  if (dir > 0) while (sweep < 0) sweep += 2 * Math.PI;
  else while (sweep > 0) sweep -= 2 * Math.PI;
  const r = Math.abs(s);
  return Array.from({ length: steps + 1 }, (_, i) => {
    const ang = a0 + (sweep * i) / steps;
    return [c[0] + r * Math.cos(ang), c[1] + r * Math.sin(ang)] as Point;
  });
}

function line(a: Point, b: Point, steps: number): Point[] {
  return Array.from({ length: steps + 1 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / steps, a[1] + ((b[1] - a[1]) * i) / steps] as Point);
}

/** The diagram in the file's stock-and-flow view, or undefined when it has no positions. */
export function parseDiagram(root: Element, { idOf, polarityOf }: Lookups): Diagram | undefined {
  const views = [...root.getElementsByTagName("view")];
  const view = views.find((v) => (v.getAttribute("type") ?? "stock_flow") === "stock_flow");
  if (!view) return undefined;

  const large = (view.getAttribute("isee:converter_size") ?? view.getAttribute("converter_size")) === "large";
  const auxSize: Point = large ? [27, 27] : [18, 18];

  const shapes: Shape[] = [];
  const byVar = new Map<string, Shape>(); // variable id -> its main shape
  const byUid = new Map<string, { shape: Shape; id?: string }>(); // alias uid -> its shape and variable
  const flowEls: { el: Element; shape: Shape }[] = [];

  for (const el of view.children) {
    const kind = el.localName;
    if (!["stock", "flow", "aux", "alias"].includes(kind)) continue;
    const size = kind === "stock" ? STOCK_SIZE : auxSize;
    const at = place(el, size);
    if (!at) continue;
    const name = kind === "alias" ? (child(el, "of")?.textContent ?? "").trim() : (el.getAttribute("name") ?? "");
    const side = el.getAttribute("label_side") ?? "";
    const shape: Shape = {
      kind: kind === "flow" ? "valve" : (kind as Shape["kind"]),
      ...at,
      label: name.replace(/^"|"$/g, "").replace(/_/g, " ").split(/\\n|\n/).map((s) => s.trim()).filter(Boolean),
      labelSide: (SIDES.has(side) ? side : kind === "stock" ? "center" : "bottom") as Shape["labelSide"],
    };
    if (kind === "flow") Object.assign(shape, { w: 18, h: 18 });
    shapes.push(shape);
    const id = idOf(name);
    if (kind === "alias") {
      const uid = el.getAttribute("uid");
      if (uid) byUid.set(uid, { shape, id });
    } else if (id) {
      byVar.set(id, shape);
    }
    if (kind === "flow") flowEls.push({ el, shape });
  }
  if (!shapes.length) return undefined;

  // Flow pipes. An end that doesn't touch a stock comes from or goes to a cloud.
  const stocks = shapes.filter((s) => s.kind === "stock");
  const pipes: Diagram["pipes"] = [];
  for (const { el } of flowEls) {
    const pts = child(el, "pts");
    const points = (pts ? children(pts, "pt") : [])
      .map((p) => [num(p, "x"), num(p, "y")])
      .filter((p): p is Point => p.every((v) => v !== undefined && Number.isFinite(v)));
    if (points.length < 2) continue;
    const touches = (p: Point) => stocks.some((s) => inside(s, p, 4));
    pipes.push({ points, cloudStart: !touches(points[0]), cloudEnd: !touches(points[points.length - 1]) });
  }

  // Connectors, trimmed so they start and end at the edge of their shapes.
  const arrows: Diagram["arrows"] = [];
  const endOf = (el: Element | undefined): { shape?: Shape; id?: string } => {
    if (!el) return {};
    const alias = child(el, "alias");
    if (alias) {
      return byUid.get(alias.getAttribute("uid") ?? "") ?? {};
    }
    const id = idOf((el.textContent ?? "").trim());
    return { shape: id ? byVar.get(id) : undefined, id };
  };
  for (const c of view.children) {
    if (c.localName !== "connector") continue;
    const from = endOf(child(c, "from"));
    const to = endOf(child(c, "to"));
    if (!from.shape || !to.shape || from.shape === to.shape) continue;
    const pts = arcPoints([from.shape.x, from.shape.y], [to.shape.x, to.shape.y], num(c, "angle"));
    let i = 0;
    while (i < pts.length - 1 && inside(from.shape, pts[i])) i++;
    let j = pts.length - 1;
    while (j > i && inside(to.shape, pts[j])) j--;
    if (j - i < 1) continue;
    arrows.push({
      points: pts.slice(i, j + 1),
      polarity: from.id && to.id ? polarityOf(from.id, to.id) : undefined,
    });
  }

  // The author's R and B loop markers.
  const loops: Diagram["loops"] = [];
  for (const el of view.children) {
    if (el.localName !== "loop_indicator") continue;
    const at = place(el, [30, 30]);
    const text = el.getAttribute("text") ?? "";
    if (!at || !text) continue;
    const name = [...el.children].find((e) => e.localName === "name")?.textContent?.replace(/\s+/g, " ").trim();
    loops.push({ x: at.x, y: at.y, r: Math.max(at.w, at.h) / 2, text, name: name || undefined });
  }

  // Bounds of everything drawn, with room for labels.
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of shapes) {
    xs.push(s.x - s.w / 2 - 30, s.x + s.w / 2 + 30);
    ys.push(s.y - s.h / 2 - 20, s.y + s.h / 2 + 30);
  }
  for (const [x, y] of [...pipes.flatMap((p) => p.points), ...arrows.flatMap((a) => a.points)]) {
    xs.push(x);
    ys.push(y);
  }
  for (const l of loops) {
    xs.push(l.x - l.r, l.x + l.r);
    ys.push(l.y - l.r, l.y + l.r);
  }
  const minX = Math.min(...xs) - MARGIN;
  const minY = Math.min(...ys) - MARGIN;
  const box: Diagram["box"] = [minX, minY, Math.max(...xs) + MARGIN - minX, Math.max(...ys) + MARGIN - minY];

  return { box, shapes, pipes, arrows, loops };
}

/** "on the left, near the top" style words for where a point sits in the diagram. */
function region(d: Diagram, x: number, y: number): string {
  const [bx, by, bw, bh] = d.box;
  const col = ["on the left", "in the middle", "on the right"][Math.min(2, Math.floor(((x - bx) / bw) * 3))];
  const row = ["near the top", "", "near the bottom"][Math.min(2, Math.floor(((y - by) / bh) * 3))];
  return row ? `${col}, ${row}` : col;
}

/** A short spoken description of where the stocks and loop markers are. */
export function describeLayout(d: Diagram): string | undefined {
  const parts: string[] = [];
  for (const s of d.shapes.filter((s) => s.kind === "stock")) parts.push(`${s.label.join(" ")} is ${region(d, s.x, s.y)}`);
  for (const l of d.loops) {
    const what = l.text === "R" ? "reinforcing" : l.text === "B" ? "balancing" : "loop";
    parts.push(`a ${what} loop marker${l.name ? ` named ${l.name}` : ""}, labeled ${l.text}, is ${region(d, l.x, l.y)}`);
  }
  if (!parts.length) return undefined;
  const sentences = parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1) + ".");
  return `Positions as drawn in the file. ${sentences.join(" ")}`;
}
