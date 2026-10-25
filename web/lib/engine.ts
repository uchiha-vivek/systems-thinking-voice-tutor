// Graph engine: every structural fact the voice agent speaks comes from here.
import { weightedRatio } from "rapidfuzz-js/fuzz";

import type { Diagram } from "./diagram";

export type Polarity = "+" | "-" | "?";
type LoopType = "R" | "B" | "?";

export interface ModelData {
  id: string;
  title: string;
  description?: string;
  verified?: boolean;
  overview?: { short?: string };
  layout_description?: string;
  /** Where the diagram came from, e.g. "an uploaded Stella file". Unset for the built-in examples. */
  source?: string;
  /** Free text the author left on the diagram. */
  notes?: string[];
  /** Things the student should be told about how far to trust this model. */
  caveats?: string[];
  variables: {
    id: string;
    label: string;
    kind?: string;
    description?: string;
    aliases?: string[];
    units?: string;
    /** A constant's value, or a stock's starting value. */
    value?: number;
    /** How it is calculated, in words. For a stock, how its starting value is calculated. */
    equation?: string;
    inflows?: string[];
    outflows?: string[];
  }[];
  links: {
    from: string;
    to: string;
    polarity?: Polarity;
    delay?: boolean;
    explanation?: string;
    /** A link from a flow into the stock it fills or drains. */
    kind?: "inflow" | "outflow";
    /** The author's own reasoning for this link. */
    reasoning?: string;
  }[];
  loops?: { id: string; name?: string; narrative?: string; variables: string[] }[];
  behavior_graphs?: unknown[];
  /** Where things are drawn, read from a Stella file. Only the page uses it, to draw the diagram. */
  diagram?: Diagram;
  behavior_note?: string;
}

interface Edge {
  polarity: Polarity;
  delay: boolean;
  kind?: "inflow" | "outflow";
  reasoning?: string;
}

interface Loop {
  id: string;
  type: LoopType;
  name: string | null;
  narrative: string | null;
  variables: string[];
  edges: [string, string][];
}

export type ToolResult = Record<string, unknown>;

const NUMBER_WORDS: Record<string, string> = {
  zero: "0", one: "1", two: "2", three: "3", four: "4", five: "5",
  six: "6", seven: "7", eight: "8", nine: "9", point: ".", dot: ".",
};
const TYPE_WORDS: Record<LoopType, string> = { R: "reinforcing", B: "balancing", "?": "unknown" };
const MAX_LOOP_LENGTH = 12;
const MAX_PATH_LENGTH = 6;
const MAX_LOOPS = 2000; // a big stock-and-flow model can have thousands; stop looking past this
const MAX_SEARCH_STEPS = 3_000_000;
const OVERVIEW_LOOPS = 8; // how many loops the overview lists before saying "and N more"
const MAX_LISTED = 6; // longest list of choices or loops read out in one answer

const strip = (s: string) => s.replace(/[^a-z0-9]/g, "");

/** 'B three point one' / 'b3.1' / 'B 3.1' -> 'b31'. */
function norm(text: string): string {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean).map((w) => NUMBER_WORDS[w] ?? w);
  return strip(words.join(""));
}

/** Every run of up to maxLen consecutive words, normalized. Used to match loop ids as whole words. */
function spans(text: string, maxLen = 5): Set<string> {
  const words = (text.toLowerCase().match(/[a-z0-9.]+/g) ?? []).map((w) => NUMBER_WORDS[w] ?? w);
  const out = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j <= Math.min(i + maxLen, words.length); j++) {
      out.add(strip(words.slice(i, j).join("")));
    }
  }
  return out;
}

export class ModelGraph {
  readonly data: ModelData;
  private vars = new Map<string, ModelData["variables"][number]>();
  // Insertion-ordered adjacency, so "what affects X" always lists links in the author's order.
  private succ = new Map<string, Map<string, Edge>>();
  private pred = new Map<string, Map<string, Edge>>();
  private names = new Map<string, string>();
  readonly loops: Loop[];
  /** False when the search for loops was cut short, so there may be more than listed. */
  loopsComplete = true;

  constructor(data: ModelData) {
    this.data = data;
    for (const v of data.variables) {
      this.vars.set(v.id, v);
      this.succ.set(v.id, new Map());
      this.pred.set(v.id, new Map());
    }
    for (const link of data.links) {
      const edge: Edge = {
        polarity: link.polarity ?? "?",
        delay: link.delay ?? false,
        kind: link.kind,
        reasoning: link.reasoning,
      };
      this.succ.get(link.from)!.set(link.to, edge);
      this.pred.get(link.to)!.set(link.from, edge);
    }
    for (const [vid, v] of this.vars) {
      for (const name of [v.label, vid.replaceAll("_", " "), ...(v.aliases ?? [])]) {
        this.names.set(name.toLowerCase(), vid);
      }
    }
    this.loops = this.computeLoops();
  }

  // ---------- helpers ----------
  private label(vid: string): string {
    return this.vars.get(vid)!.label;
  }

  private edge(u: string, v: string): Edge {
    return this.succ.get(u)!.get(v)!;
  }

  private effectPhrase(u: string, v: string): string {
    const { polarity: pol, kind } = this.edge(u, v);
    if (kind === "inflow") return `When ${this.label(u)} goes up, ${this.label(v)} fills faster.`;
    if (kind === "outflow") return `When ${this.label(u)} goes up, ${this.label(v)} drains faster.`;
    if (pol === "+") return `When ${this.label(u)} goes up, ${this.label(v)} goes up.`;
    if (pol === "-") return `When ${this.label(u)} goes up, ${this.label(v)} goes down.`;
    return `The effect of ${this.label(u)} on ${this.label(v)} is unclear in this diagram.`;
  }

  /** Spoken name -> variable ids. One id = confident; several = ask the student. */
  resolve(name: string): string[] {
    const q = name.toLowerCase().trim();
    const exact = this.names.get(q);
    if (exact) return [exact];
    const hits = [...this.names.keys()]
      .map((n) => ({ n, score: weightedRatio(q, n) }))
      .sort((a, b) => b.score - a.score) // stable: ties keep the author's order
      .slice(0, 6);
    if (!hits.length || hits[0].score < 70) return [];
    const top = hits[0].score;
    const ids: string[] = [];
    for (const { n, score } of hits) {
      const vid = this.names.get(n)!;
      if (score >= top - 5 && !ids.includes(vid)) ids.push(vid);
    }
    return ids;
  }

  // ---------- loops ----------
  /** Loops the author declared come first, in file order; any others follow in a stable order. */
  private computeLoops(): Loop[] {
    const order = [...this.vars.keys()];
    const rank = new Map(order.map((id, i) => [id, i]));
    const declared = new Map<string, NonNullable<ModelData["loops"]>[number]>();
    for (const l of this.data.loops ?? []) declared.set([...l.variables].sort().join("|"), l);
    const declaredOrder = [...declared.values()];

    // Each elementary cycle is found once, starting from its first variable in file order.
    const cycles: string[][] = [];
    let steps = 0;
    for (const start of order) {
      const path = [start];
      const dfs = (node: string) => {
        for (const next of this.succ.get(node)!.keys()) {
          if (++steps > MAX_SEARCH_STEPS || cycles.length >= MAX_LOOPS) {
            this.loopsComplete = false;
            return;
          }
          if (next === start) cycles.push([...path]);
          else if (rank.get(next)! > rank.get(start)! && !path.includes(next) && path.length < MAX_LOOP_LENGTH) {
            path.push(next);
            dfs(next);
            path.pop();
          }
        }
      };
      dfs(start);
    }

    const keyOf = (c: string[]) => [...c].sort().join("|");
    const position = (c: string[]) => {
      const d = declared.get(keyOf(c));
      return d ? declaredOrder.indexOf(d) : declaredOrder.length;
    };
    const ordered = cycles
      .map((c, i) => ({ c, i }))
      .sort((a, b) => position(a.c) - position(b.c) || a.c.length - b.c.length || a.i - b.i);

    const counters: Record<LoopType, number> = { R: 0, B: 0, "?": 0 };
    return ordered.map(({ c }) => {
      const d = declared.get(keyOf(c));
      let cycle = c;
      if (d && cycle.includes(d.variables[0])) {
        // start where the author starts
        const i = cycle.indexOf(d.variables[0]);
        cycle = [...cycle.slice(i), ...cycle.slice(0, i)];
      }
      const edges = cycle.map((u, i) => [u, cycle[(i + 1) % cycle.length]] as [string, string]);
      const pols = edges.map(([u, v]) => this.edge(u, v).polarity);
      const type: LoopType = pols.includes("?") ? "?" : pols.filter((p) => p === "-").length % 2 ? "B" : "R";
      if (!d) counters[type] += 1;
      return {
        id: d?.id ?? `${type}${counters[type]}`,
        type,
        name: d?.name ?? null,
        narrative: d?.narrative ?? null,
        variables: cycle,
        edges,
      };
    });
  }

  findLoops(query: string): Loop[] {
    const q = norm(query);
    const s = spans(query);
    for (const loop of this.loops) {
      if (s.has(norm(loop.id))) return [loop];
      if (loop.name && q.includes(norm(loop.name))) return [loop];
    }
    const words = query.toLowerCase();
    let cands = this.loops;
    if (words.includes("reinforc")) cands = cands.filter((l) => l.type === "R");
    else if (words.includes("balanc")) cands = cands.filter((l) => l.type === "B");
    const mentioned = new Set([...this.names].filter(([name]) => words.includes(name)).map(([, vid]) => vid));
    if (mentioned.size) {
      const narrowed = cands.filter((l) => l.variables.some((v) => mentioned.has(v)));
      if (narrowed.length) cands = narrowed;
    }
    return cands;
  }

  private loopSummary(loop: Loop) {
    return {
      id: loop.id,
      type: TYPE_WORDS[loop.type],
      name: loop.name,
      variables: loop.variables.map((v) => this.label(v)),
    };
  }

  // ---------- tool responses ----------
  overview(): ToolResult {
    const loopCount = new Map([...this.vars.keys()].map((id) => [id, 0]));
    for (const loop of this.loops) {
      for (const vid of loop.variables) loopCount.set(vid, loopCount.get(vid)! + 1);
    }
    const key = [...this.vars.keys()].sort((a, b) => loopCount.get(b)! - loopCount.get(a)!).slice(0, 3);
    const kinds = (kind: string) => [...this.vars.values()].filter((v) => v.kind === kind).map((v) => v.label);
    const unclear = this.data.links.filter((l) => (l.polarity ?? "?") === "?").length;
    const caveats = [...(this.data.caveats ?? [])];
    if (unclear) {
      caveats.push(
        `${unclear} of the ${this.data.links.length} links have a direction that could not be worked out, so they will be called unclear.`,
      );
    }
    if (!this.loopsComplete) caveats.push("This model has too many loops to find them all, so some are missing from the list.");
    const extra = this.data.source
      ? {
          source: this.data.source,
          stocks: kinds("stock"),
          flows: kinds("flow"),
          number_of_links: this.data.links.length,
          loop_counts: {
            reinforcing: this.loops.filter((l) => l.type === "R").length,
            balancing: this.loops.filter((l) => l.type === "B").length,
            unclear: this.loops.filter((l) => l.type === "?").length,
          },
          author_notes: this.data.notes,
        }
      : {};
    return {
      title: this.data.title,
      summary: this.data.overview?.short || this.data.description || "",
      verified_by_instructor: this.data.verified ?? (this.data.source ? null : false),
      number_of_variables: this.vars.size,
      number_of_loops: this.loops.length,
      loops: this.loops.slice(0, OVERVIEW_LOOPS).map((l) => this.loopSummary(l)),
      more_loops_not_listed: Math.max(0, this.loops.length - OVERVIEW_LOOPS),
      key_variables: key.filter((v) => loopCount.get(v)! > 0).map((v) => this.label(v)),
      has_behavior_over_time_graph: Boolean(this.data.behavior_graphs?.length),
      ...extra,
      caveats: caveats.length ? caveats : undefined,
    };
  }

  variable(name: string): ToolResult {
    const ids = this.resolve(name);
    if (!ids.length) {
      return {
        error: `No variable matches '${name}'.`,
        available_variables: [...this.vars.values()].map((v) => v.label),
      };
    }
    if (ids.length > 1) {
      return { ambiguous: true, ask_student_which_one: ids.map((i) => this.label(i)) };
    }
    const vid = ids[0];
    const v = this.vars.get(vid)!;
    const isStock = v.kind === "stock";
    return {
      variable: v.label,
      kind: v.kind ?? "variable",
      description: v.description ?? null,
      units: v.units,
      [isStock ? "starting_value" : "set_to"]: v.value,
      [isStock ? "starting_value_calculation" : "how_it_is_calculated"]: v.equation,
      flows_in: v.inflows?.length ? v.inflows : undefined,
      flows_out: v.outflows?.length ? v.outflows : undefined,
      affected_by: [...this.pred.get(vid)!].map(([u, e]) => ({
        variable: this.label(u),
        effect: this.effectPhrase(u, vid),
        has_delay: e.delay,
        author_reasoning: e.reasoning,
      })),
      affects: [...this.succ.get(vid)!].map(([w, e]) => ({
        variable: this.label(w),
        effect: this.effectPhrase(vid, w),
        has_delay: e.delay,
        author_reasoning: e.reasoning,
      })),
      ...(() => {
        const mine = this.loops.filter((l) => l.variables.includes(vid));
        return {
          part_of_loops: mine.slice(0, MAX_LISTED).map((l) => this.loopSummary(l)),
          ...(mine.length > MAX_LISTED ? { total_loops_it_is_part_of: mine.length } : {}),
        };
      })(),
    };
  }

  loop(query: string): ToolResult {
    const found = this.findLoops(query);
    if (!found.length) return { error: "This model has no feedback loops." };
    if (found.length > 1) {
      return {
        ambiguous: true,
        ask_student_which_one: found.slice(0, MAX_LISTED).map((l) => this.loopSummary(l)),
        ...(found.length > MAX_LISTED ? { total_matching_loops: found.length } : {}),
      };
    }
    const loop = found[0];
    const steps = loop.edges.map(
      ([u, v]) => this.effectPhrase(u, v) + (this.edge(u, v).delay ? " This takes time (delay)." : ""),
    );
    const meaning: Record<LoopType, string> = {
      R: "This is a reinforcing loop: a change keeps amplifying itself, causing growth or collapse.",
      B: "This is a balancing loop: it pushes back against change and moves the system toward a limit.",
      "?": "The loop type is unknown because at least one link's sign is unclear.",
    };
    return {
      ...this.loopSummary(loop),
      steps_in_order: steps,
      closes_back_to: this.label(loop.variables[0]),
      what_it_means: meaning[loop.type],
      author_explanation: loop.narrative,
    };
  }

  /** Up to the 3 shortest simple paths from `from` to `to`, at most MAX_PATH_LENGTH links long. */
  private simplePaths(from: string, to: string): string[][] {
    const found: string[][] = [];
    const path = [from];
    const dfs = (node: string) => {
      for (const next of this.succ.get(node)!.keys()) {
        if (path.includes(next)) continue;
        if (next === to) found.push([...path, next]);
        else if (path.length < MAX_PATH_LENGTH) {
          path.push(next);
          dfs(next);
          path.pop();
        }
      }
    };
    dfs(from);
    return found.sort((a, b) => a.length - b.length).slice(0, 3);
  }

  path(fromName: string, toName: string): ToolResult {
    const a = this.resolve(fromName);
    const b = this.resolve(toName);
    if (a.length !== 1 || b.length !== 1) {
      return {
        ambiguous_or_missing: true,
        from_matches: a.map((i) => this.label(i)),
        to_matches: b.map((i) => this.label(i)),
      };
    }
    if (a[0] === b[0]) {
      return { same_variable: true, message: `Both names mean ${this.label(a[0])}. Ask about two different variables.` };
    }
    const paths = this.simplePaths(a[0], b[0]);
    if (!paths.length) {
      return {
        connected: false,
        message: `${this.label(a[0])} does not affect ${this.label(b[0])} in this model.`,
      };
    }
    return {
      connected: true,
      paths: paths.map((p) => {
        const links = p.slice(1).map((v, i) => [p[i], v] as const);
        const pols = links.map(([u, v]) => this.edge(u, v).polarity);
        const net = pols.includes("?") ? "unclear" : pols.filter((x) => x === "-").length % 2 ? "goes down" : "goes up";
        return {
          chain: p.map((x) => this.label(x)),
          steps: links.map(([u, v]) => this.effectPhrase(u, v)),
          overall: `If ${this.label(p[0])} goes up, ${this.label(p[p.length - 1])} ${net} through this chain.`,
        };
      }),
    };
  }

  behavior(): ToolResult {
    const graphs = this.data.behavior_graphs ?? [];
    if (!graphs.length) return { error: "This model has no behavior-over-time graph." };
    return { graphs, note: this.data.behavior_note };
  }

  layout(): ToolResult {
    return { layout: this.data.layout_description ?? "No layout information was recorded for this diagram." };
  }
}
