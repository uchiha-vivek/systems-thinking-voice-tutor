// Reads a Vensim (.mdl) file into the structure the graph engine uses, the same shape parseStella
// produces. Equations are translated into the Stella syntax lib/equation.ts reads.
//
// Stocks are the variables defined with INTEG; the terms added in INTEG are inflows and the terms
// taken away are outflows. Link directions come from the author's +/- mark on a drawn arrow when
// there is one, otherwise from the equation, and are "?" when the equation can't settle it.
import { describeLayout, type Diagram, type Point, type Shape } from "./diagram";
import type { ModelData } from "./engine";
import {
  canonName,
  describeEquation,
  parseEquation,
  referencedNames,
  signsOf,
  type Node,
  type Sign,
} from "./equation";
import { spokenLabel } from "./stella";

export class VensimError extends Error {}

type Link = NonNullable<ModelData["links"]>[number];
type Variable = ModelData["variables"][number];

const NOT_MDL = "That file is not a Vensim model. Upload a file that ends in .mdl.";
const CONTROL = new Set(["initial_time", "final_time", "time_step", "saveper"]);

const cleanLabel = (name: string) => name.replace(/\\n/g, " ").replace(/_/g, " ").replace(/\s+/g, " ").trim();
const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "uploaded-model";
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isNumber = (s: string) => /^[-+]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s.trim());
const times = (a: Sign, b: Sign): Sign => (a === "?" || b === "?" ? "?" : a === b ? "+" : "-");

// ---------- small text helpers ----------

/** Index of the parenthesis that closes the one at `open`, skipping quoted names. */
function closeParen(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      const end = s.indexOf('"', i + 1);
      if (end < 0) return -1;
      i = end;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Splits on commas that are not inside parentheses, brackets or quotes. */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') {
      const end = s.indexOf('"', i + 1);
      i = end < 0 ? s.length : end;
    } else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      out.push(s.slice(start, i));
      start = i + 1;
    }
  }
  out.push(s.slice(start));
  return out.map((a) => a.trim());
}

/** "a - b + c" -> [["+", "a"], ["-", "b"], ["+", "c"]], splitting only at the top level. */
function splitTerms(s: string): [1 | -1, string][] {
  const out: [1 | -1, string][] = [];
  let depth = 0;
  let sign: 1 | -1 = 1;
  let start = 0;
  const t = s.trim();
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"') {
      const end = t.indexOf('"', i + 1);
      i = end < 0 ? t.length : end;
    } else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if ((c === "+" || c === "-") && depth === 0) {
      const before = t.slice(start, i).trim();
      if (!before) {
        // a sign at the start of a term
        if (c === "-") sign = sign === 1 ? -1 : 1;
        start = i + 1;
        continue;
      }
      if (/[0-9.][eE]$/.test(before) || /[*/^(,=<>]$/.test(before)) continue; // 1e-3, a * -b
      out.push([sign, before]);
      sign = c === "-" ? -1 : 1;
      start = i + 1;
    }
  }
  const last = t.slice(start).trim();
  if (last) out.push([sign, last]);
  return out;
}

/** The (x, y) points of a lookup table, written either as pairs or as all x's then all y's. */
function tablePoints(body: string): Point[] {
  const noRange = body.replace(/\[[^\]]*\]/g, "");
  const pairs = [...noRange.matchAll(/\(\s*([-+0-9.eE]+)\s*,\s*([-+0-9.eE]+)\s*\)/g)].map(
    (m) => [Number(m[1]), Number(m[2])] as Point,
  );
  if (pairs.length) return pairs.filter((p) => p.every(Number.isFinite));
  const nums = noRange.split(/[(),\s]+/).filter(Boolean).map(Number);
  if (nums.length < 4 || nums.length % 2 || nums.some((n) => !Number.isFinite(n))) return [];
  const half = nums.length / 2;
  return nums.slice(0, half).map((x, i) => [x, nums[half + i]] as Point);
}

/** Which way a lookup table pushes its output as its input rises. */
function tableDirection(pts: Point[]): Sign {
  const ys = pts.map((p) => p[1]);
  if (ys.length < 2) return "?";
  const rises = ys.some((y, i) => i > 0 && y > ys[i - 1]);
  const falls = ys.some((y, i) => i > 0 && y < ys[i - 1]);
  return rises && !falls ? "+" : falls && !rises ? "-" : "?";
}

const tableRange = (pts: Point[]): [number, number] | undefined =>
  pts.length ? [Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[1]))] : undefined;

const tableWords = (dir: Sign) => (dir === "+" ? "rises" : dir === "-" ? "falls" : "rises and falls");

// Vensim functions written with spaces, and the Stella name lib/equation.ts knows them by.
const RENAME: Record<string, string> = {
  smooth: "smooth",
  smoothi: "smoothi",
  smooth3: "smooth3",
  smooth3i: "smooth3i",
  smooth_n: "smthn",
  delay1: "delay1",
  delay1i: "delay1i",
  delay3: "delay3",
  delay3i: "delay3i",
  delay_n: "delayn",
  delay_fixed: "delay",
  integer: "int",
};

/** Rewrites Vensim-only functions into forms parseEquation reads. Quoted names are left alone. */
function rewriteCalls(s: string): string {
  let out = "";
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === '"') {
      const end = s.indexOf('"', i + 1);
      const stop = end < 0 ? s.length : end + 1;
      out += s.slice(i, stop);
      i = stop;
      continue;
    }
    const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (m && !/[A-Za-z0-9_]/.test(s[i - 1] ?? "")) {
      const after = s.slice(i + m[0].length);
      const gap = /^\s*/.exec(after)![0].length;
      const fn = m[0].toLowerCase();
      if (after[gap] === "(") {
        const open = i + m[0].length + gap;
        const close = closeParen(s, open);
        if (close < 0) throw new VensimError("unbalanced parentheses");
        const args = splitArgs(s.slice(open + 1, close)).map(rewriteCalls);
        out += callFor(fn, args) ?? `${m[0]}(${args.join(", ")})`;
        i = close + 1;
        continue;
      }
      out += m[0];
      i += m[0].length;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function callFor(fn: string, a: string[]): string | undefined {
  switch (fn) {
    case "if_then_else":
      return a.length === 3 ? `(IF (${a[0]}) THEN (${a[1]}) ELSE (${a[2]}))` : undefined;
    case "xidz":
    case "zidz":
      return a.length >= 2 ? `((${a[0]}) // (${a[1]}))` : undefined;
    case "modulo":
      return a.length === 2 ? `((${a[0]}) mod (${a[1]}))` : undefined;
    case "power":
      return a.length === 2 ? `((${a[0]}) ^ (${a[1]}))` : undefined;
  }
  return fn in RENAME ? `${RENAME[fn]}(${a.join(", ")})` : undefined;
}

/** Splits a CSV-ish sketch line, keeping quoted names together. */
function sketchFields(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

// ---------- the equations section ----------

interface Entry {
  name: string;
  id: string;
  /** The right-hand side as written, with line continuations joined. */
  expr?: string;
  /** Points of a named lookup definition. */
  table?: Point[];
  units: string;
  comment: string;
}

function readEntries(eqText: string): Entry[] {
  const entries: Entry[] = [];
  for (const raw of eqText.split("|")) {
    if (!raw.trim()) continue;
    const [left, units = "", comment = ""] = raw.split("~");
    const body = left.trim();
    if (!body || body.startsWith("*")) continue; // group headers like ****** .Control ******
    if (/:MACRO:/i.test(body)) throw new VensimError("Models that use macros are not supported yet.");
    let name: string;
    let rest: string;
    if (body.startsWith('"')) {
      const end = body.indexOf('"', 1);
      if (end < 0) throw new VensimError(NOT_MDL);
      name = body.slice(1, end);
      rest = body.slice(end + 1).trim();
    } else {
      const m = /^[^=([:]*/.exec(body)!;
      name = m[0].trim();
      rest = body.slice(m[0].length).trim();
    }
    if (!name) continue;
    const entry: Entry = {
      name,
      id: canonName(name),
      units: units.replace(/\[[^\]]*\]/g, "").trim(),
      comment: comment.replace(/\s+/g, " ").trim(),
    };
    if (rest.startsWith("[") || (rest.startsWith(":") && !rest.startsWith(":="))) {
      throw new VensimError("Models that use subscripts are not supported yet.");
    }
    if (rest.startsWith("(")) {
      const close = closeParen(rest, 0);
      entry.table = tablePoints(rest.slice(1, close < 0 ? undefined : close));
    } else if (rest) {
      entry.expr = rest.replace(/^(:=|==|=)/, "").trim();
    }
    entries.push(entry);
  }
  return entries;
}

// ---------- the sketch section ----------

interface SketchRecord {
  type: number;
  f: string[];
  /** Text on the line after a comment record. */
  text?: string;
}

function readSketch(sketch: string): { title?: string; records: SketchRecord[] } {
  const lines = sketch.split("\n");
  let title: string | undefined;
  const records: SketchRecord[] = [];
  let views = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.startsWith("///---\\\\\\")) break; // end of the sketch
    if (line.startsWith("*")) {
      // Only the first view is drawn: each view has its own coordinates.
      if (++views > 1) break;
      title = line.slice(1).trim();
      continue;
    }
    const m = /^(\d+),/.exec(line);
    if (!m || !views) continue;
    const rec: SketchRecord = { type: Number(m[1]), f: sketchFields(line) };
    if (rec.type === 12 && /^\d+$/.test(rec.f[2] ?? "") && rec.f[2] !== "48") {
      const next = lines[i + 1]?.trim() ?? "";
      if (next && !/^\d+,/.test(next) && !/^[*$\\/]/.test(next)) {
        rec.text = next;
        i++;
      }
    } else if (rec.type === 12 && rec.f[2] !== "48") {
      rec.text = rec.f[2];
    }
    records.push(rec);
  }
  return { title, records };
}

/** True when p is inside the shape, plus a little padding so arrows stop just short of it. */
function inside(s: Shape, [px, py]: Point, pad = 3): boolean {
  if (s.kind === "stock") return Math.abs(px - s.x) <= s.w / 2 + pad && Math.abs(py - s.y) <= s.h / 2 + pad;
  return Math.hypot(px - s.x, py - s.y) <= Math.max(s.w, s.h) / 2 + pad;
}

/** Where the line from p to the stock's center crosses the stock's edge. */
function edgeOf(s: Shape, p: Point): Point {
  const dx = p[0] - s.x;
  const dy = p[1] - s.y;
  if (!dx && !dy) return [s.x, s.y];
  const t = Math.min(dx ? s.w / 2 / Math.abs(dx) : Infinity, dy ? s.h / 2 / Math.abs(dy) : Infinity);
  return [s.x + dx * t, s.y + dy * t];
}

/** A curve from a to b that passes through the arrow's handle at its middle. */
function curve(a: Point, b: Point, handle: Point | undefined, steps = 48): Point[] {
  const c: Point = handle ? [2 * handle[0] - (a[0] + b[0]) / 2, 2 * handle[1] - (a[1] + b[1]) / 2] : [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  return Array.from({ length: steps + 1 }, (_, i) => {
    const t = i / steps;
    const u = 1 - t;
    return [u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]] as Point;
  });
}

const pointsOf = (line: string[]): Point[] => {
  const tail = line.join(",");
  const at = tail.indexOf("|");
  if (at < 0) return [];
  return [...tail.slice(at).matchAll(/\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g)].map((m) => [Number(m[1]), Number(m[2])] as Point);
};

interface SketchLookups {
  idOf: (name: string) => string | undefined;
  kindOf: (id: string) => string | undefined;
  /** Whether a flow fills ("in") or drains ("out") the given stock. */
  flowRole: (flow: string, stock: string) => "in" | "out" | undefined;
}

function buildDiagram(records: SketchRecord[], { idOf, kindOf, flowRole }: SketchLookups) {
  const shapes: Shape[] = [];
  const bySketchId = new Map<string, Shape>(); // sketch id -> the shape arrows attach to
  const clouds = new Map<string, Point>();
  const valves = new Map<string, Point>();
  const seen = new Set<string>();
  const loops: Diagram["loops"] = [];
  const texts: string[] = [];
  let lastValve: string | undefined;

  for (const r of records) {
    const [, sid] = r.f;
    const x = Number(r.f[3]);
    const y = Number(r.f[4]);
    const w = Number(r.f[5]);
    const h = Number(r.f[6]);
    if (![x, y].every(Number.isFinite)) continue;
    if (r.type === 11) {
      valves.set(sid, [x, y]);
      lastValve = sid;
      continue;
    }
    const valve = lastValve;
    lastValve = undefined;
    if (r.type === 12) {
      if (r.f[2] === "48") clouds.set(sid, [x, y]);
      else {
        const t = (r.text ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
        if (/^[RB]\d*$/i.test(t)) loops.push({ x, y, r: Math.max(w, h, 10), text: t.toUpperCase() });
        else if (t && !texts.includes(t)) texts.push(t);
      }
      continue;
    }
    if (r.type !== 10) continue;
    const name = r.f[2] ?? "";
    const id = idOf(name);
    const bits = Number(r.f[8]);
    const shadow = (id !== undefined && seen.has(id)) || (Number.isFinite(bits) && (bits & 3) === 2);
    const kind = id ? kindOf(id) : undefined;
    const label = name.split(/\\n|\n/).map((s) => s.replace(/_/g, " ").trim()).filter(Boolean);
    let shape: Shape;
    if (valve && !shadow) {
      // A flow's name is written just after its valve; draw them as one valve shape.
      const [vx, vy] = valves.get(valve)!;
      shape = { kind: "valve", x: vx, y: vy, w: 18, h: 18, label, labelSide: "bottom" };
      bySketchId.set(valve, shape);
    } else if (shadow) {
      shape = { kind: "alias", x, y, w: 18, h: 18, label, labelSide: "bottom" };
    } else if (kind === "stock") {
      shape = { kind: "stock", x, y, w: Number.isFinite(w) ? 2 * w : 90, h: Number.isFinite(h) ? 2 * h : 70, label, labelSide: "center" };
    } else {
      shape = { kind: kind === "flow" ? "valve" : "aux", x, y, w: 18, h: 18, label, labelSide: "bottom" };
    }
    if (id && !shadow) {
      shape.id = id;
      seen.add(id);
    }
    shapes.push(shape);
    bySketchId.set(sid, shape);
  }
  if (!shapes.length) return { diagram: undefined, texts, arrowEnds: [] as [string, string][] };

  const arrows: Diagram["arrows"] = [];
  const arrowEnds: [string, string][] = []; // sketch ids at each end of each arrow
  const pipeEnds = new Map<string, { end: string; pts: Point[]; head: boolean }[]>();
  const influences: { from: Shape; to: Shape; handle?: Point; ends: [string, string] }[] = [];
  for (const r of records) {
    if (r.type !== 1) continue;
    const [, , from, to] = r.f;
    const pts = pointsOf(r.f);
    const shapeNo = Number(r.f[4]);
    // Pipe pieces join a valve to a stock or a cloud.
    const [v, end] = valves.has(from) ? [from, to] : valves.has(to) ? [to, from] : [];
    if (v && end && (clouds.has(end) || bySketchId.get(end)?.kind === "stock")) {
      const list = pipeEnds.get(v) ?? [];
      list.push({ end, pts, head: (shapeNo === 4) === (v === from) });
      pipeEnds.set(v, list);
      continue;
    }
    const a = bySketchId.get(from);
    const b = bySketchId.get(to);
    if (!a || !b || a === b) continue;
    influences.push({ from: a, to: b, handle: pts[0], ends: [from, to] });
  }

  // Flow pipes, from upstream end through the valve to downstream end.
  const pipes: Diagram["pipes"] = [];
  for (const [v, ends] of pipeEnds) {
    if (ends.length !== 2) continue;
    const center = valves.get(v)!;
    const flow = bySketchId.get(v)?.id;
    const roleOf = (e: (typeof ends)[number]) => {
      const s = bySketchId.get(e.end);
      if (!s?.id || !flow) return undefined;
      const role = flowRole(flow, s.id);
      return role === "out" ? "up" : role === "in" ? "down" : undefined;
    };
    let [up, down] = ends;
    const r0 = roleOf(ends[0]);
    const r1 = roleOf(ends[1]);
    if (r0 === "down" || r1 === "up") [up, down] = [ends[1], ends[0]];
    else if (!r0 && !r1 && ends[0].head && !ends[1].head) [up, down] = [ends[1], ends[0]];
    const between = (p: Point, q: Point) => (m: Point) =>
      m[0] >= Math.min(p[0], q[0]) - 1 && m[0] <= Math.max(p[0], q[0]) + 1 && m[1] >= Math.min(p[1], q[1]) - 1 && m[1] <= Math.max(p[1], q[1]) + 1;
    const leg = (e: (typeof ends)[number]): Point[] => {
      const cloud = clouds.get(e.end);
      const stock = bySketchId.get(e.end);
      const far: Point = cloud ?? [stock!.x, stock!.y];
      const mid = e.pts.filter(between(center, far));
      const last = mid[mid.length - 1] ?? center;
      return [...mid, cloud ?? edgeOf(stock!, last)];
    };
    const upLeg = leg(up).reverse();
    pipes.push({
      points: [...upLeg, center, ...leg(down)],
      cloudStart: clouds.has(up.end),
      cloudEnd: clouds.has(down.end),
    });
  }

  // Influence arrows, trimmed so they start and end at the edge of their shapes.
  for (const { from, to, handle, ends } of influences) {
    const pts = curve([from.x, from.y], [to.x, to.y], handle);
    let i = 0;
    while (i < pts.length - 1 && inside(from, pts[i])) i++;
    let j = pts.length - 1;
    while (j > i && inside(to, pts[j])) j--;
    if (j - i < 1) continue;
    arrows.push({ points: pts.slice(i, j + 1) });
    arrowEnds.push(ends);
  }

  // Bounds of everything drawn, with room for labels (as in lib/diagram.ts).
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
  const MARGIN = 40;
  const minX = Math.min(...xs) - MARGIN;
  const minY = Math.min(...ys) - MARGIN;
  const box: Diagram["box"] = [minX, minY, Math.max(...xs) + MARGIN - minX, Math.max(...ys) + MARGIN - minY];
  const diagram: Diagram = { box, shapes, pipes, arrows, loops };
  return { diagram, texts, arrowEnds };
}

const MARKS: Record<string, "+" | "-"> = { "43": "+", "45": "-", "83": "+", "79": "-" };

// ---------- putting it together ----------

export function parseVensim(src: string): ModelData {
  const text = src.replace(/^﻿/, "").replace(/\r\n?/g, "\n").replace(/^\s*\{UTF-8\}\s*/i, "");
  if (/^\s*</.test(text) || !text.includes("~") || !text.includes("|")) throw new VensimError(NOT_MDL);
  const split = text.indexOf("\\\\\\---///");
  const eqText = (split < 0 ? text : text.slice(0, split)).replace(/\\[ \t]*\n/g, " ");
  const sketchText = split < 0 ? "" : text.slice(split);

  const entries = readEntries(eqText);
  const caveats: string[] = [];
  const control = new Map(entries.filter((e) => CONTROL.has(e.id)).map((e) => [e.id, e]));
  const model = entries.filter((e) => !CONTROL.has(e.id));
  if (!model.length) throw new VensimError("That Vensim model has no variables in it.");

  // Every name the equations may mention, longest first, so "Contact Rate Effect" wins over "Contact Rate".
  const patterns = entries
    .map((e) => e.id)
    .sort((a, b) => b.length - a.length)
    .map((id): [RegExp, string] => [
      new RegExp(`(?<![A-Za-z0-9_"$])${id.split("_").map(escapeRe).join("[\\s_]+")}(?![A-Za-z0-9_"$])`, "gi"),
      id,
    ]);
  const lookups = new Map(model.filter((e) => e.table).map((e) => [e.id, e.table!]));

  /** Vensim text -> text with every known name as "canonical_name" and functions joined by _. */
  const prepare = (expr: string) => {
    let s = expr.replace(/"([^"]*)"/g, (_, n: string) => `"${canonName(n)}"`);
    s = s.replace(/:AND:/gi, " and ").replace(/:OR:/gi, " or ").replace(/:NOT:/gi, " not ");
    for (const [re, id] of patterns) s = s.replace(re, `"${id}"`);
    // Multi-word function names, like IF THEN ELSE( -> IF_THEN_ELSE(
    s = s.replace(/[A-Za-z][A-Za-z0-9_]*(?:[ \t]+[A-Za-z][A-Za-z0-9_]*)+(?=\s*\()/g, (words) => {
      const parts = words.split(/[ \t]+/);
      const lead: string[] = [];
      while (parts.length > 1 && /^(and|or|not)$/i.test(parts[0])) lead.push(parts.shift()!);
      return [...lead, parts.join("_")].join(" ");
    });
    const bare = s.replace(/"[^"]*"/g, "").replace(/\[\s*\([^\]]*\)\s*\]/g, ""); // lookup ranges like [(0,0)-(1,1)]
    if (/\[/.test(bare)) throw new VensimError("Models that use subscripts are not supported yet.");
    return s;
  };
  const toAst = (expr: string) => parseEquation(rewriteCalls(expr));

  // ---------- first pass: what each entry is ----------
  type Info = {
    e: Entry;
    kind: "stock" | "flow" | "variable";
    ast: Node | null;
    /** For a stock: the INTEG rate split into terms, and its starting value. */
    terms?: [1 | -1, string][];
    rate?: Node | null;
    init?: Node | null;
    /** A WITH LOOKUP table. */
    table?: Point[];
    sketchOnly?: string[];
  };
  const infos: Info[] = [];
  const unreadable = (e: Entry) =>
    caveats.push(`The equation for ${spokenLabel(cleanLabel(e.name))} could not be read, so its links are marked unclear.`);
  for (const e of model) {
    const info: Info = { e, kind: "variable", ast: null };
    infos.push(info);
    if (!e.expr) continue;
    let pre: string;
    try {
      pre = prepare(e.expr);
    } catch (err) {
      if (err instanceof VensimError) throw err;
      unreadable(e);
      continue;
    }
    const call = /^(integ|with_lookup|a_function_of)\s*\(/i.exec(pre);
    const close = call ? closeParen(pre, call[0].length - 1) : -1;
    const args = call && close > 0 ? splitArgs(pre.slice(call[0].length, close)) : [];
    try {
      if (call?.[1].toLowerCase() === "integ" && args.length === 2) {
        info.kind = "stock";
        info.terms = splitTerms(args[0]);
        info.rate = toAst(args[0]);
        info.init = toAst(args[1]);
      } else if (call?.[1].toLowerCase() === "with_lookup" && args.length >= 2) {
        info.table = tablePoints(args.slice(1).join(","));
        info.ast = toAst(args[0]);
      } else if (call?.[1].toLowerCase() === "a_function_of") {
        info.sketchOnly = args.map((a) => canonName(a.replace(/^"|"$/g, "")));
      } else {
        info.ast = toAst(pre);
      }
    } catch (err) {
      if (err instanceof VensimError && /not supported/.test(err.message)) throw err;
      unreadable(e);
    }
  }
  if (infos.some((i) => i.sketchOnly)) {
    caveats.push("Some variables are only sketched, with no equation yet, so their links are marked unclear.");
  }

  // Flows are the plain names added to or taken from a stock.
  const flowsOf = new Map<string, { in: string[]; out: string[] }>();
  for (const s of infos.filter((i) => i.kind === "stock")) {
    const io = { in: [] as string[], out: [] as string[] };
    for (const [sign, term] of s.terms ?? []) {
      const m = /^"([^"]+)"$/.exec(term.trim());
      const id = m?.[1];
      const other = id ? infos.find((i) => i.e.id === id) : undefined;
      if (!id || !other || other.kind === "stock" || lookups.has(id)) continue;
      other.kind = "flow";
      (sign > 0 ? io.in : io.out).push(id);
    }
    flowsOf.set(s.e.id, io);
  }

  // ---------- variables ----------
  const variables: Variable[] = [];
  const byName = new Map<string, string>();
  for (const { e, kind } of infos) {
    const label = spokenLabel(cleanLabel(e.name));
    const units = /^dmnl$/i.test(e.units) ? "dimensionless" : e.units;
    const v: Variable = {
      id: e.id,
      label,
      aliases: label === cleanLabel(e.name) ? undefined : [cleanLabel(e.name)],
      kind,
      description: e.comment || undefined,
      units: units || undefined,
    };
    variables.push(v);
    byName.set(e.id, e.id);
  }
  const labelOf = new Map(variables.map((v) => [v.id, v.label]));
  const idOf = (name: string) => byName.get(canonName(name.replace(/^"|"$/g, "")));
  const varOf = new Map(variables.map((v) => [v.id, v]));

  // A named lookup used like a function: for direction-finding, swap in a curve that moves the same way.
  const lookupDir = new Map([...lookups].map(([id, pts]) => [id, tableDirection(pts)]));
  const forSigns = (n: Node): Node => {
    switch (n.t) {
      case "neg":
      case "not":
        return { ...n, a: forSigns(n.a) };
      case "bin":
        return { ...n, a: forSigns(n.a), b: forSigns(n.b) };
      case "if":
        return { ...n, c: forSigns(n.c), a: forSigns(n.a), b: forSigns(n.b) };
      case "call": {
        const args = n.args.map(forSigns);
        const dir = lookupDir.get(n.fn);
        if (dir === "+" && args.length === 1) return args[0];
        if (dir === "-" && args.length === 1) {
          return { t: "bin", op: "/", a: { t: "num", v: 1 }, b: { t: "bin", op: "+", a: { t: "num", v: 1 }, b: args[0] } };
        }
        return { ...n, args };
      }
      default:
        return n;
    }
  };
  const describe = (n: Node): string => {
    const named: string[] = [];
    const swap = (x: Node): Node => {
      switch (x.t) {
        case "neg":
        case "not":
          return { ...x, a: swap(x.a) };
        case "bin":
          return { ...x, a: swap(x.a), b: swap(x.b) };
        case "if":
          return { ...x, c: swap(x.c), a: swap(x.a), b: swap(x.b) };
        case "call":
          if (lookups.has(x.fn) && x.args.length === 1) {
            named.push(`the lookup table ${labelOf.get(x.fn)} applied to ${describe(x.args[0])}`);
            return { t: "id", name: `\u0000${named.length - 1}` };
          }
          return { ...x, args: x.args.map(swap) };
        default:
          return x;
      }
    };
    return describeEquation(swap(n), (name) =>
      name.startsWith("\u0000") ? named[Number(name.slice(1))] : (labelOf.get(idOf(name) ?? "") ?? name.replace(/_/g, " ")),
    );
  };

  /** Lowest and highest value a variable can take, when a lookup table bounds it. */
  const rangeOf = (id: string): [number, number] | undefined => {
    const info = infos.find((i) => i.e.id === id);
    if (info?.table) return tableRange(info.table);
    if (info?.ast?.t === "call" && lookups.has(info.ast.fn)) return tableRange(lookups.get(info.ast.fn)!);
    return undefined;
  };

  // ---------- links ----------
  const links = new Map<string, Link>();
  const put = (from: string, to: string, link: Partial<Link>) => {
    const key = `${from}\u0000${to}`;
    links.set(key, { ...(links.get(key) ?? { from, to, polarity: "?" }), ...link });
  };
  const signLinks = (ast: Node, to: string, outer: Sign = "+") => {
    const known = [...referencedNames(ast)].filter((n) => idOf(n) && idOf(n) !== to && !lookups.has(idOf(n)!));
    const constants = new Map<string, number>();
    const ranges = new Map<string, [number, number]>();
    for (const n of known) {
      const other = varOf.get(idOf(n)!)!;
      if (other.kind !== "stock" && other.value !== undefined) constants.set(n, other.value);
      const range = rangeOf(other.id);
      if (range) ranges.set(n, range);
    }
    const signs = signsOf(forSigns(ast), known, to, constants, ranges);
    for (const n of known) put(idOf(n)!, to, { polarity: times(signs.get(n) ?? "?", outer) });
  };

  for (const info of infos) {
    const v = varOf.get(info.e.id)!;
    const expr = info.e.expr ?? "";
    if (info.kind === "stock") {
      const io = flowsOf.get(v.id)!;
      v.inflows = io.in.map((x) => labelOf.get(x)!);
      v.outflows = io.out.map((x) => labelOf.get(x)!);
      for (const f of io.in) put(f, v.id, { polarity: "+", kind: "inflow" });
      for (const f of io.out) put(f, v.id, { polarity: "-", kind: "outflow" });
      // Anything else in the rate that is not a plain flow still changes the stock.
      const others = (info.terms ?? []).filter(([, t]) => {
        const id = /^"([^"]+)"$/.exec(t.trim())?.[1];
        return !(id && (io.in.includes(id) || io.out.includes(id)));
      });
      for (const [sign, term] of others) {
        try {
          signLinks(toAst(term), v.id, sign > 0 ? "+" : "-");
        } catch {
          /* the whole rate was read above; an odd term just adds no link */
        }
      }
      const init = info.init;
      if (init?.t === "num" || (init?.t === "neg" && init.a.t === "num")) v.value = init.t === "num" ? init.v : -(init.a as { v: number }).v;
      else if (init) v.equation = describe(init);
      continue;
    }
    if (info.e.table) {
      v.equation = `a lookup table that ${tableWords(tableDirection(info.e.table))} as its input grows`;
      continue;
    }
    if (info.sketchOnly) {
      for (const n of info.sketchOnly) if (idOf(n) && idOf(n) !== v.id) put(idOf(n)!, v.id, { polarity: "?" });
      v.equation = "not written yet";
      continue;
    }
    if (!expr) continue;
    if (isNumber(expr)) {
      v.value = Number(expr);
      continue;
    }
    if (info.ast) {
      const table = info.table ? tableDirection(info.table) : "+";
      signLinks(info.ast, v.id, table);
      v.equation = describe(info.ast);
      if (info.table) v.equation = `a lookup table applied to ${v.equation}; the table ${tableWords(table)} as its input grows`;
    } else {
      // Unreadable equation: still record which variables it mentions, as unclear links.
      let pre = "";
      try {
        pre = prepare(expr);
      } catch {
        /* nothing more to learn */
      }
      for (const m of pre.matchAll(/"([^"]+)"/g)) {
        const id = idOf(m[1]);
        if (id && id !== v.id && !lookups.has(id)) put(id, v.id, { polarity: "?" });
      }
    }
  }

  // ---------- the drawing ----------
  const { title: viewName, records } = readSketch(sketchText);
  const drawn = buildDiagram(records, {
    idOf,
    kindOf: (id) => varOf.get(id)?.kind,
    flowRole: (flow, stock) => {
      const io = flowsOf.get(stock);
      return io?.in.includes(flow) ? "in" : io?.out.includes(flow) ? "out" : undefined;
    },
  });

  // The author's own marks on drawn arrows beat anything derived.
  for (const r of records) {
    if (r.type !== 1) continue;
    const mark = MARKS[r.f[6] ?? ""];
    if (!mark) continue;
    const a = drawnId(records, r.f[2]);
    const b = drawnId(records, r.f[3]);
    const from = a && idOf(a);
    const to = b && idOf(b);
    if (!from || !to || from === to || lookups.has(from) || varOf.get(to)?.kind === "stock") continue;
    put(from, to, { polarity: mark });
  }
  const diagram = drawn.diagram;
  if (diagram) {
    drawn.arrowEnds.forEach(([a, b], i) => {
      const from = idOf(drawnId(records, a) ?? "");
      const to = idOf(drawnId(records, b) ?? "");
      if (from && to) diagram.arrows[i].polarity = links.get(`${from}\u0000${to}`)?.polarity;
    });
  }

  // ---------- extras for the overview ----------
  const title = viewName && !/^view \d+$/i.test(viewName) ? viewName : "Uploaded model";
  const notes = drawn.texts.slice(0, 6);
  const start = control.get("initial_time")?.expr;
  const stop = control.get("final_time")?.expr;
  if (start && stop && isNumber(start) && isNumber(stop)) {
    const unit = control.get("final_time")?.units || control.get("time_step")?.units;
    notes.push(`The model runs from ${Number(start)} to ${Number(stop)}${unit ? ` ${unit}` : ""}.`);
  }

  return {
    id: slug(title),
    title,
    source: "an uploaded Vensim file",
    verified: undefined,
    notes: notes.length ? notes : undefined,
    caveats: caveats.length ? caveats : undefined,
    variables,
    links: [...links.values()],
    diagram,
    layout_description: diagram && describeLayout(diagram),
  } as ModelData;
}

/** The variable name a sketch id stands for: a valve stands for the flow written after it. */
function drawnId(records: SketchRecord[], sid: string): string | undefined {
  const at = records.findIndex((r) => (r.type === 10 || r.type === 11) && r.f[1] === sid);
  if (at < 0) return undefined;
  const r = records[at];
  if (r.type === 10) return r.f[2];
  const next = records[at + 1];
  return next?.type === 10 ? next.f[2] : undefined;
}
