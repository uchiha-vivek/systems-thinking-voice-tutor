// Reads Stella (XMILE) equations and works out which way each input pushes the result.
//
// A blind student cannot check a "+" or "-" against the diagram, so a direction is only reported
// when it is certain: the equation is evaluated many times with the input nudged up, and the
// direction counts only if the result never moves the other way. Anything else is "?".

export type Sign = "+" | "-" | "?";

export type Node =
  | { t: "num"; v: number }
  | { t: "id"; name: string }
  | { t: "neg"; a: Node }
  | { t: "not"; a: Node }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "if"; c: Node; a: Node; b: Node }
  | { t: "call"; fn: string; args: Node[] };

export class EquationError extends Error {}

/** Stella writes names with a literal "\n" for line breaks; equations use underscores instead. */
export const canonName = (s: string) => s.replace(/\\n/g, " ").trim().replace(/\s+/g, "_").toLowerCase();

// ---------- reading ----------
type Token = { k: "num" | "id" | "op" | "kw"; v: string };
const KEYWORDS = new Set(["if", "then", "else", "and", "or", "not", "mod"]);

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) i++;
    else if (c === "{") {
      const end = src.indexOf("}", i);
      i = end < 0 ? src.length : end + 1;
    } else if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      if (j >= src.length) throw new EquationError("unterminated quoted name");
      out.push({ k: "id", v: canonName(src.slice(i + 1, j)) });
      i = j + 1;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new EquationError(`bad number at ${i}`);
      out.push({ k: "num", v: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z_À-￿]/.test(c)) {
      const m = /^[A-Za-z_À-￿][A-Za-z0-9_$À-￿]*/.exec(src.slice(i))!;
      const lower = m[0].toLowerCase();
      out.push(KEYWORDS.has(lower) ? { k: "kw", v: lower } : { k: "id", v: canonName(m[0]) });
      i += m[0].length;
    } else {
      const two = src.slice(i, i + 2);
      if (["<>", "<=", ">=", "//"].includes(two)) {
        out.push({ k: "op", v: two });
        i += 2;
      } else if ("+-*/^(),=<>".includes(c)) {
        out.push({ k: "op", v: c });
        i++;
      } else {
        throw new EquationError(`unsupported character '${c}'`);
      }
    }
  }
  return out;
}

export function parseEquation(src: string): Node {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v: string) => peek()?.k === "op" && peek().v === v;
  const isKw = (v: string) => peek()?.k === "kw" && peek().v === v;
  const expectOp = (v: string) => {
    if (!isOp(v)) throw new EquationError(`expected '${v}'`);
    p++;
  };

  function or(): Node {
    let a = and();
    while (isKw("or")) {
      p++;
      a = { t: "bin", op: "or", a, b: and() };
    }
    return a;
  }
  function and(): Node {
    let a = not();
    while (isKw("and")) {
      p++;
      a = { t: "bin", op: "and", a, b: not() };
    }
    return a;
  }
  function not(): Node {
    if (isKw("not")) return (p++, { t: "not", a: not() });
    return cmp();
  }
  function cmp(): Node {
    const a = add();
    const t = peek();
    if (t?.k === "op" && ["=", "<>", "<", ">", "<=", ">="].includes(t.v)) return (p++, { t: "bin", op: t.v, a, b: add() });
    return a;
  }
  function add(): Node {
    let a = mul();
    while (isOp("+") || isOp("-")) {
      const op = toks[p++].v;
      a = { t: "bin", op, a, b: mul() };
    }
    return a;
  }
  function mul(): Node {
    let a = unary();
    while (isOp("*") || isOp("/") || isOp("//") || isKw("mod")) {
      const op = toks[p++].v;
      a = { t: "bin", op, a, b: unary() };
    }
    return a;
  }
  function unary(): Node {
    if (isOp("-")) return (p++, { t: "neg", a: unary() });
    if (isOp("+")) return (p++, unary());
    return pow();
  }
  function pow(): Node {
    const a = primary();
    if (isOp("^")) return (p++, { t: "bin", op: "^", a, b: unary() });
    return a;
  }
  function primary(): Node {
    const t = toks[p++];
    if (!t) throw new EquationError("equation ends too early");
    if (t.k === "num") return { t: "num", v: Number(t.v) };
    if (t.k === "kw" && t.v === "if") {
      const c = or();
      if (!isKw("then")) throw new EquationError("IF without THEN");
      p++;
      const a = or();
      let b: Node = { t: "num", v: 0 };
      if (isKw("else")) {
        p++;
        b = or();
      }
      return { t: "if", c, a, b };
    }
    if (t.k === "id") {
      if (isOp("(")) {
        p++;
        const args: Node[] = [];
        if (!isOp(")")) {
          args.push(or());
          while (isOp(",")) {
            p++;
            args.push(or());
          }
        }
        expectOp(")");
        return { t: "call", fn: t.v, args };
      }
      return { t: "id", name: t.v };
    }
    if (t.k === "op" && t.v === "(") {
      const e = or();
      expectOp(")");
      return e;
    }
    throw new EquationError(`unexpected '${t.v}'`);
  }

  const ast = or();
  if (p < toks.length) throw new EquationError(`unexpected '${toks[p].v}'`);
  return ast;
}

// ---------- evaluating ----------
export class UnsupportedError extends Error {}

const PASS_FIRST = new Set([
  "smth1", "smth3", "smthn", "smooth", "smooth3", "smoothi", "smooth3i",
  "delay", "delay1", "delay3", "delayn", "delay1i", "delay3i", "delayi", "delayp",
]);
const BUILTIN_VALUES = new Set(["time", "dt", "startime", "starttime", "stoptime", "pi", "true", "false"]);

type Env = { value: (name: string) => number; time: number };

function evalNode(n: Node, env: Env): number {
  switch (n.t) {
    case "num":
      return n.v;
    case "id": {
      if (n.name === "time") return env.time;
      if (n.name === "dt") return 0.25;
      if (n.name === "pi") return Math.PI;
      if (n.name === "true") return 1;
      if (n.name === "false") return 0;
      return env.value(n.name);
    }
    case "neg":
      return -evalNode(n.a, env);
    case "not":
      return evalNode(n.a, env) ? 0 : 1;
    case "if":
      return evalNode(n.c, env) ? evalNode(n.a, env) : evalNode(n.b, env);
    case "bin": {
      const a = evalNode(n.a, env);
      const b = evalNode(n.b, env);
      switch (n.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return a / b;
        case "//": return b === 0 ? 0 : a / b; // Stella's safe divide
        case "^": return Math.pow(a, b);
        case "mod": return a - b * Math.floor(a / b);
        case "=": return a === b ? 1 : 0;
        case "<>": return a !== b ? 1 : 0;
        case "<": return a < b ? 1 : 0;
        case ">": return a > b ? 1 : 0;
        case "<=": return a <= b ? 1 : 0;
        case ">=": return a >= b ? 1 : 0;
        case "and": return a && b ? 1 : 0;
        case "or": return a || b ? 1 : 0;
      }
      throw new UnsupportedError(n.op);
    }
    case "call": {
      if (PASS_FIRST.has(n.fn)) return evalNode(n.args[0], env);
      const a = n.args.map((x) => evalNode(x, env));
      switch (n.fn) {
        case "min": return Math.min(...a);
        case "max": return Math.max(...a);
        case "abs": return Math.abs(a[0]);
        case "sqrt": return Math.sqrt(a[0]);
        case "exp": return Math.exp(a[0]);
        case "ln": return Math.log(a[0]);
        case "log10": return Math.log10(a[0]);
        case "int": return Math.trunc(a[0]);
        case "round": return Math.round(a[0]);
        case "sin": return Math.sin(a[0]);
        case "cos": return Math.cos(a[0]);
        case "tan": return Math.tan(a[0]);
        case "step": return env.time >= a[1] && (a.length < 3 || env.time < a[1] + a[2]) ? a[0] : 0;
      }
      throw new UnsupportedError(n.fn);
    }
  }
}

/** Names the equation actually computes with, i.e. not tucked away in an ignored argument. */
function evaluatedNames(n: Node, out = new Set<string>()): Set<string> {
  switch (n.t) {
    case "id":
      out.add(n.name);
      break;
    case "neg":
    case "not":
      evaluatedNames(n.a, out);
      break;
    case "bin":
      evaluatedNames(n.a, out);
      evaluatedNames(n.b, out);
      break;
    case "if":
      evaluatedNames(n.c, out);
      evaluatedNames(n.a, out);
      evaluatedNames(n.b, out);
      break;
    case "call":
      (PASS_FIRST.has(n.fn) ? n.args.slice(0, 1) : n.args).forEach((a) => evaluatedNames(a, out));
      break;
  }
  return out;
}

/** Every name written in the equation, including ones in arguments the evaluator ignores. */
export function referencedNames(n: Node, out = new Set<string>()): Set<string> {
  switch (n.t) {
    case "id":
      if (!BUILTIN_VALUES.has(n.name)) out.add(n.name);
      break;
    case "neg":
    case "not":
      referencedNames(n.a, out);
      break;
    case "bin":
      referencedNames(n.a, out);
      referencedNames(n.b, out);
      break;
    case "if":
      referencedNames(n.c, out);
      referencedNames(n.a, out);
      referencedNames(n.b, out);
      break;
    case "call":
      n.args.forEach((a) => referencedNames(a, out));
      break;
  }
  return out;
}

/** Names used directly in a comparison, like "switch = 0": these get small whole numbers tried. */
function comparedNames(n: Node, out = new Set<string>()): Set<string> {
  const walk = (x: Node) => {
    switch (x.t) {
      case "bin":
        if (["=", "<>", "<", ">", "<=", ">="].includes(x.op)) {
          for (const side of [x.a, x.b]) if (side.t === "id") out.add(side.name);
        }
        walk(x.a);
        walk(x.b);
        break;
      case "neg":
      case "not":
        walk(x.a);
        break;
      case "if":
        walk(x.c);
        walk(x.a);
        walk(x.b);
        break;
      case "call":
        x.args.forEach(walk);
        break;
    }
  };
  walk(n);
  return out;
}

function rng(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TRIALS = 120;

/**
 * For each requested name: "+" if raising it never lowers the result (and sometimes raises it),
 * "-" for the reverse, "?" if it goes both ways, never changes anything, or can't be evaluated.
 */
export function signsOf(
  ast: Node,
  names: string[],
  seed = "",
  /** Variables that are fixed numbers in the model: tried near their real value, not at random. */
  constants: Map<string, number> = new Map(),
  /** Variables whose values stay inside a known range, like a lookup table's output. */
  ranges: Map<string, [number, number]> = new Map(),
): Map<string, Sign> {
  const result = new Map<string, Sign>();
  const real = evaluatedNames(ast);
  const all = [...referencedNames(ast)];
  const random = rng(seed + JSON.stringify(ast));
  const compared = comparedNames(ast);

  const counts = new Map(names.map((n) => [n, { up: 0, down: 0 }]));
  try {
    for (let trial = 0; trial < TRIALS; trial++) {
      const base = new Map(
        all.map((n): [string, number] => {
          // small whole numbers now and then, so tests like "switch = 0" get exercised
          if (compared.has(n) && random() < 0.4) return [n, Math.floor(random() * 4)];
          const fixed = constants.get(n);
          if (fixed !== undefined) return [n, random() < 0.5 ? fixed : fixed * (0.7 + random() * 0.7)];
          const range = ranges.get(n);
          if (range) return [n, range[0] + random() * (range[1] - range[0])];
          // otherwise log-uniform from 0.01 to 1000, so both tiny and huge values are tried
          return [n, Math.exp(Math.log(0.01) + random() * Math.log(1e5))];
        }),
      );
      const time = random() * 100;
      const run = (vals: Map<string, number>) =>
        evalNode(ast, { time, value: (n) => vals.get(n) ?? 1 });
      const before = run(base);
      for (const name of names) {
        if (!real.has(name) || !base.has(name)) continue;
        const was = base.get(name)!;
        const bumped = new Map(base).set(name, was === 0 ? 1 : was * 1.5);
        const after = run(bumped);
        if (!Number.isFinite(before) || !Number.isFinite(after)) continue;
        const diff = after - before;
        if (Math.abs(diff) <= 1e-9 * Math.max(1, Math.abs(before))) continue;
        counts.get(name)![diff > 0 ? "up" : "down"]++;
      }
    }
  } catch (err) {
    if (!(err instanceof UnsupportedError)) throw err;
    for (const name of names) result.set(name, "?");
    return result;
  }
  for (const [name, { up, down }] of counts) {
    result.set(name, up > 0 && down === 0 ? "+" : down > 0 && up === 0 ? "-" : "?");
  }
  return result;
}

/** The equation in plain words, with each variable shown by its label. */
export function describeEquation(n: Node, label: (name: string) => string): string {
  const show = (x: Node, parent = 0): string => {
    switch (x.t) {
      case "num":
        return String(x.v);
      case "id":
        return label(x.name);
      case "neg":
        return `minus ${show(x.a, 3)}`;
      case "not":
        return `not ${show(x.a, 3)}`;
      case "if":
        return `if ${show(x.c)} then ${show(x.a)} otherwise ${show(x.b)}`;
      case "call":
        return `${x.fn.toUpperCase()} of ${x.args.map((a) => show(a)).join(", ")}`;
      case "bin": {
        const words: Record<string, [string, number]> = {
          "+": ["plus", 1], "-": ["minus", 1], "*": ["times", 2], "/": ["divided by", 2], "//": ["divided by", 2], "^": ["to the power of", 3], mod: ["mod", 2],
          "=": ["equals", 0], "<>": ["is not equal to", 0], "<": ["is less than", 0], ">": ["is greater than", 0],
          "<=": ["is at most", 0], ">=": ["is at least", 0], and: ["and", 0], or: ["or", 0],
        };
        const [w, prec] = words[x.op];
        const s = `${show(x.a, prec)} ${w} ${show(x.b, prec + (x.op === "-" || x.op === "/" || x.op === "//" ? 1 : 0))}`;
        return prec < parent ? `(${s})` : s;
      }
    }
  };
  return show(n);
}
