// Reads a Stella / XMILE (.stmx) file into the structure the graph engine uses.
//
// Everything structural (variables, flows in and out of stocks, which variable uses which) is read
// directly from the file. The direction of each link comes from the author's own +/- mark when the
// connector has one, otherwise from the equation, and is "?" when the equation can't settle it.
import { describeLayout, parseDiagram } from "./diagram";
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

export class StellaError extends Error {}

type Link = NonNullable<ModelData["links"]>[number];
type Variable = ModelData["variables"][number];

const children = (el: Element, name: string) => [...el.children].filter((c) => c.localName === name);
const child = (el: Element, name: string) => children(el, name)[0];
const text = (el: Element | undefined) => el?.textContent?.trim() ?? "";

/** "Susceptible\nPopulation S" -> "Susceptible Population S" */
const cleanLabel = (name: string) => name.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();

const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "uploaded-model";

/** Stella appends the units on their own last line of the description; speech doesn't need it twice. */
function cleanDoc(doc: string, units: string): string {
  const paras = doc.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
  if (paras.length > 1) {
    const last = paras[paras.length - 1];
    if (last.length < 40 && !/[.!?]$/.test(last)) paras.pop();
  } else if (paras.length === 1 && units && paras[0].toLowerCase() === units.toLowerCase()) {
    paras.pop();
  }
  return paras.join(" ");
}

/** The lowest and highest value a table (graphical function) can output. */
function tableRange(gf: Element): [number, number] | undefined {
  const ys = text(child(gf, "ypts")).split(/[,\s]+/).filter(Boolean).map(Number).filter(Number.isFinite);
  return ys.length ? [Math.min(...ys), Math.max(...ys)] : undefined;
}

/** Which way a table (graphical function) pushes its output as its input rises. */
function tableDirection(gf: Element): Sign {
  const ys = text(child(gf, "ypts"))
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);
  if (ys.length < 2 || ys.some((y) => !Number.isFinite(y))) return "?";
  const rises = ys.some((y, i) => i > 0 && y > ys[i - 1]);
  const falls = ys.some((y, i) => i > 0 && y < ys[i - 1]);
  return rises && !falls ? "+" : falls && !rises ? "-" : "?";
}

const times = (a: Sign, b: Sign): Sign => (a === "?" || b === "?" ? "?" : a === b ? "+" : "-");

export function parseStella(xml: string): ModelData {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    throw new StellaError("That file could not be read as XML, so it is probably not a Stella model.");
  }
  const root = doc.documentElement;
  if (root.localName !== "xmile") {
    throw new StellaError("That file is not a Stella model. Upload a file that ends in .stmx.");
  }
  const model = child(root, "model");
  const section = model && child(model, "variables");
  if (!section) throw new StellaError("That Stella file has no model in it.");

  const caveats: string[] = [];
  const raw = [...section.children].filter((e) => ["stock", "flow", "aux"].includes(e.localName));
  const skipped = [...section.children].filter((e) => e.localName === "module");
  if (skipped.length) caveats.push("This file contains sub-models, which are not read yet.");
  if (!raw.length) throw new StellaError("That Stella model has no variables in it.");
  if (raw.some((e) => child(e, "dimensions") || children(e, "element").length)) {
    throw new StellaError("Models that use arrays are not supported yet.");
  }

  // ---------- variables ----------
  const variables: Variable[] = [];
  const byName = new Map<string, string>(); // canonical equation name -> variable id
  const info = new Map<string, { el: Element; ast: Node | null; eqn: string }>();
  for (const el of raw) {
    const name = el.getAttribute("name") ?? "";
    let id = canonName(name);
    for (let n = 2; info.has(id); n++) id = `${canonName(name)}_${n}`;
    const units = text(child(el, "units"));
    const eqn = text(child(el, "eqn"));
    const v: Variable = {
      id,
      label: cleanLabel(name),
      kind: el.localName === "aux" ? "variable" : el.localName,
      description: cleanDoc(text(child(el, "doc")), units) || undefined,
      units: units || undefined,
    };
    if (/^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(eqn)) v.value = Number(eqn);
    variables.push(v);
    byName.set(canonName(name), id);
    let ast: Node | null = null;
    try {
      ast = eqn ? parseEquation(eqn) : null;
    } catch {
      caveats.push(`The equation for ${v.label} could not be read, so its links are marked unclear.`);
    }
    info.set(id, { el, ast, eqn });
  }
  const labelOf = new Map(variables.map((v) => [v.id, v.label]));
  const idOf = (name: string) => byName.get(canonName(name.replace(/^"|"$/g, "")));

  // ---------- links ----------
  const links = new Map<string, Link>();
  const put = (from: string, to: string, link: Partial<Link>) => {
    const key = `${from}\u0000${to}`;
    links.set(key, { ...(links.get(key) ?? { from, to, polarity: "?" }), ...link });
  };

  for (const v of variables) {
    const { el, ast, eqn } = info.get(v.id)!;
    if (el.localName === "stock") {
      // A stock's equation is only its starting value, so it adds no feedback link. Flows do.
      v.inflows = children(el, "inflow").map((e) => idOf(text(e))).filter((x): x is string => !!x).map((x) => labelOf.get(x)!);
      v.outflows = children(el, "outflow").map((e) => idOf(text(e))).filter((x): x is string => !!x).map((x) => labelOf.get(x)!);
      for (const f of children(el, "inflow")) {
        const from = idOf(text(f));
        if (from) put(from, v.id, { polarity: "+", kind: "inflow" });
      }
      for (const f of children(el, "outflow")) {
        const from = idOf(text(f));
        if (from) put(from, v.id, { polarity: "-", kind: "outflow" });
      }
      v.equation = eqn && v.value === undefined ? describeEquation(ast ?? { t: "num", v: 0 }, (n) => labelOf.get(idOf(n) ?? "") ?? n) : undefined;
      continue;
    }
    if (!eqn) continue;

    if (ast) {
      const names = [...referencedNames(ast)];
      const known = names.filter((n) => idOf(n));
      const gf = child(el, "gf");
      const table = gf ? tableDirection(gf) : "+";
      const constants = new Map<string, number>();
      for (const n of known) {
        const other = variables.find((x) => x.id === idOf(n));
        if (other?.kind !== "stock" && other?.value !== undefined) constants.set(n, other.value);
      }
      const ranges = new Map<string, [number, number]>();
      for (const n of known) {
        const other = info.get(idOf(n)!)!;
        const otherGf = child(other.el, "gf");
        const range = otherGf && tableRange(otherGf);
        if (range) ranges.set(n, range);
      }
      const signs = signsOf(ast, known, v.id, constants, ranges);
      for (const n of known) {
        put(idOf(n)!, v.id, { polarity: times(signs.get(n) ?? "?", table) });
      }
      if (v.value === undefined) v.equation = describeEquation(ast, (n) => labelOf.get(idOf(n) ?? "") ?? n.replace(/_/g, " "));
      if (gf) v.equation = `a lookup table applied to ${v.equation ?? "its input"}; the table ${table === "+" ? "rises" : table === "-" ? "falls" : "rises and falls"} as its input grows`;
    } else {
      // Unreadable equation: still record which variables it mentions, as unclear links.
      const compact = canonName(eqn);
      for (const [name, id] of byName) if (id !== v.id && new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(compact)) put(id, v.id, { polarity: "?" });
    }
  }

  // The author's own drawn connectors: a +/- mark and reasoning there beat anything derived.
  for (const c of root.getElementsByTagName("connector")) {
    const from = child(c, "from");
    const to = child(c, "to");
    if (!from || !to) continue;
    const a = idOf(text(from));
    const b = idOf(text(to));
    if (!a || !b) continue;
    const mark = c.getAttribute("polarity");
    const reasoning = [...c.children].find((e) => e.localName === "reasoning");
    const patch: Partial<Link> = {};
    if (mark === "+" || mark === "-") patch.polarity = mark;
    if (reasoning && text(reasoning)) patch.reasoning = text(reasoning);
    if (links.has(`${a}\u0000${b}`) && !Object.keys(patch).length) continue;
    put(a, b, patch);
  }

  // ---------- extras for the overview and behavior tools ----------
  const title = cleanLabel(text(child(child(root, "header") ?? root, "name")).replace(/_/g, " ")) || "Uploaded model";
  const notes: string[] = [];
  for (const t of root.getElementsByTagName("text_box")) {
    const s = text(t).replace(/\s+/g, " ");
    if (s && !/^[A-Za-z ]*=/.test(s) && !notes.includes(s) && notes.length < 6) notes.push(s);
  }
  const specs = child(root, "sim_specs");
  if (specs) {
    const unit = specs.getAttribute("time_units");
    const start = text(child(specs, "start"));
    const stop = text(child(specs, "stop"));
    if (start && stop) notes.push(`The model runs from ${start} to ${stop}${unit ? ` ${unit}` : ""}.`);
  }

  const graphs: unknown[] = [];
  const seen = new Set<string>();
  for (const g of root.getElementsByTagName("graph")) {
    if (g.getAttribute("comparative") === "true") continue;
    const series = [...g.getElementsByTagName("entity")]
      .map((e) => labelOf.get(idOf(e.getAttribute("name") ?? "") ?? ""))
      .filter((x): x is string => !!x);
    const key = series.join("|");
    if (!series.length || seen.has(key)) continue;
    seen.add(key);
    const named = g.parentElement?.getAttribute("name");
    graphs.push({ title: named || `Graph ${graphs.length + 1}`, series });
  }

  const diagram = parseDiagram(root, {
    idOf,
    polarityOf: (from, to) => links.get(`${from}\u0000${to}`)?.polarity,
  });

  return {
    id: slug(title),
    title,
    source: "an uploaded Stella file",
    verified: undefined,
    notes: notes.length ? notes : undefined,
    caveats: caveats.length ? caveats : undefined,
    variables,
    links: [...links.values()],
    diagram,
    layout_description: diagram && describeLayout(diagram),
    behavior_graphs: graphs.length ? graphs : undefined,
    behavior_note: graphs.length
      ? "The file records which variables each graph plots, but not the results of a simulation run, so the shapes of the curves are not known."
      : undefined,
  } as ModelData;
}
