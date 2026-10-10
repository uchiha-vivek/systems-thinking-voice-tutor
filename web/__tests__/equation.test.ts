import { describe, expect, it } from "vitest";
import { canonName, describeEquation, EquationError, parseEquation, referencedNames, signsOf } from "@/lib/equation";

const signs = (eq: string, names: string[], constants?: Map<string, number>) =>
  Object.fromEntries(signsOf(parseEquation(eq), names, "t", constants));

describe("names", () => {
  it("matches how Stella writes names in equations", () => {
    expect(canonName("Susceptible\\nPopulation S")).toBe("susceptible_population_s");
    expect(canonName("  Total Population N ")).toBe("total_population_n");
  });

  it("reads quoted names and comments", () => {
    const ast = parseEquation('"Effect of X (E)" * y { a comment }');
    expect([...referencedNames(ast)].sort()).toEqual(["effect_of_x_(e)", "y"]);
  });

  it("does not count TIME or DT as variables", () => {
    expect([...referencedNames(parseEquation("TIME * rate + DT"))]).toEqual(["rate"]);
  });
});

describe("directions", () => {
  it("division: the numerator pushes the same way, the divisor the opposite way", () => {
    expect(signs("infected/recovery_time", ["infected", "recovery_time"])).toEqual({ infected: "+", recovery_time: "-" });
  });

  it("products and sums", () => {
    expect(signs("a*b + c", ["a", "b", "c"])).toEqual({ a: "+", b: "+", c: "+" });
  });

  it("subtraction flips the second term", () => {
    expect(signs("a - b", ["a", "b"])).toEqual({ a: "+", b: "-" });
  });

  it("Stella's safe divide behaves like division", () => {
    expect(signs("a // b", ["a", "b"])).toEqual({ a: "+", b: "-" });
  });

  it("MIN and MAX never run against their inputs", () => {
    expect(signs("MIN(a, b)", ["a", "b"])).toEqual({ a: "+", b: "+" });
    expect(signs("MAX(a, b) - c", ["a", "b", "c"])).toEqual({ a: "+", b: "+", c: "-" });
  });

  it("a hump-shaped relationship is unclear, not guessed", () => {
    expect(signs("a*(10-a)", ["a"])).toEqual({ a: "?" });
  });

  it("IF/THEN/ELSE: the branches are clear, the switch is not", () => {
    expect(signs("IF (sw = 0) THEN a ELSE b", ["sw", "a", "b"])).toEqual({ sw: "?", a: "+", b: "+" });
  });

  it("a smoothing function follows its input, and its time constant is unclear", () => {
    expect(signs("SMTH1(x, d)", ["x", "d"])).toEqual({ x: "+", d: "?" });
  });

  it("an unsupported function makes everything unclear", () => {
    expect(signs("RANDOM(a, b, 1)", ["a", "b"])).toEqual({ a: "?", b: "?" });
  });

  it("uses a constant's real value, so a sign that depends on it can be settled", () => {
    // (hi - lo) * e is only increasing in e if hi > lo.
    expect(signs("(hi - lo) * e", ["e"], new Map([["hi", 12], ["lo", 0.25]]))).toEqual({ e: "+" });
    expect(signs("(hi - lo) * e", ["e"])).toEqual({ e: "?" });
  });

  it("gives the same answer every time", () => {
    const a = signs("a*(10-a)+b", ["a", "b"]);
    expect(signs("a*(10-a)+b", ["a", "b"])).toEqual(a);
  });
});

describe("describing an equation in words", () => {
  const label = (n: string) => n.replace(/_/g, " ");

  it("uses words for the operators", () => {
    expect(describeEquation(parseEquation("a*b/c"), label)).toBe("a times b divided by c");
  });

  it("keeps grouping where it matters", () => {
    expect(describeEquation(parseEquation("(a+b)*c"), label)).toBe("(a plus b) times c");
  });

  it("describes IF and function calls", () => {
    expect(describeEquation(parseEquation("IF x > 1 THEN MIN(a, b) ELSE 0"), label)).toBe(
      "if x is greater than 1 then MIN of a, b otherwise 0",
    );
  });
});

describe("what it refuses to read", () => {
  it.each(["a +", "a[1]", "(a", "a b", "a $ b", "IF a THEN"])("rejects %s", (eq) => {
    expect(() => parseEquation(eq)).toThrow(EquationError);
  });
});
