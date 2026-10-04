"""Graph engine: every structural fact the voice agent speaks comes from here."""
import json
import re
from pathlib import Path

import networkx as nx
from rapidfuzz import fuzz, process

MODELS_DIR = Path(__file__).parent / "models"

NUMBER_WORDS = {
    "zero": "0", "one": "1", "two": "2", "three": "3", "four": "4", "five": "5",
    "six": "6", "seven": "7", "eight": "8", "nine": "9", "point": ".", "dot": ".",
}
TYPE_WORDS = {"R": "reinforcing", "B": "balancing", "?": "unknown"}


def _norm(text: str) -> str:
    """'B three point one' / 'b3.1' / 'B 3.1' -> 'b31'."""
    words = [NUMBER_WORDS.get(w, w) for w in text.lower().split()]
    return re.sub(r"[^a-z0-9]", "", "".join(words))


def _spans(text: str, max_len: int = 5) -> set[str]:
    """Every run of up to max_len consecutive words, normalized. Used to match loop ids as whole words."""
    words = [NUMBER_WORDS.get(w, w) for w in re.findall(r"[a-z0-9.]+", text.lower())]
    return {
        re.sub(r"[^a-z0-9]", "", "".join(words[i:j]))
        for i in range(len(words))
        for j in range(i + 1, min(i + max_len, len(words)) + 1)
    }


class ModelGraph:
    def __init__(self, data: dict):
        self.data = data
        self.vars = {v["id"]: v for v in data["variables"]}
        self.G = nx.DiGraph()
        self.G.add_nodes_from(self.vars)
        for link in data["links"]:
            self.G.add_edge(
                link["from"], link["to"],
                polarity=link.get("polarity", "?"),
                delay=link.get("delay", False),
                explanation=link.get("explanation"),
            )
        self.names: dict[str, str] = {}
        for vid, v in self.vars.items():
            for name in [v["label"], vid.replace("_", " "), *v.get("aliases", [])]:
                self.names[name.lower()] = vid
        self.loops = self._compute_loops()

    # ---------- helpers ----------
    def label(self, vid: str) -> str:
        return self.vars[vid]["label"]

    def effect_phrase(self, u: str, v: str) -> str:
        pol = self.G[u][v]["polarity"]
        if pol == "+":
            return f"When {self.label(u)} goes up, {self.label(v)} goes up."
        if pol == "-":
            return f"When {self.label(u)} goes up, {self.label(v)} goes down."
        return f"The effect of {self.label(u)} on {self.label(v)} is unclear in this diagram."

    def resolve(self, name: str) -> list[str]:
        """Spoken name -> variable ids. One id = confident; several = ask the student."""
        q = name.lower().strip()
        if q in self.names:
            return [self.names[q]]
        hits = process.extract(q, list(self.names), scorer=fuzz.WRatio, limit=6)
        if not hits or hits[0][1] < 70:
            return []
        top = hits[0][1]
        ids: list[str] = []
        for n, score, _ in hits:
            if score >= top - 5 and self.names[n] not in ids:
                ids.append(self.names[n])
        return ids

    # ---------- loops ----------
    def _compute_loops(self) -> list[dict]:
        declared = {frozenset(l["variables"]): l for l in self.data.get("loops", [])}
        counters = {"R": 0, "B": 0, "?": 0}
        loops = []
        for cycle in nx.simple_cycles(self.G, length_bound=12):
            d = declared.get(frozenset(cycle), {})
            if d and d["variables"][0] in cycle:  # start where the author starts
                i = cycle.index(d["variables"][0])
                cycle = cycle[i:] + cycle[:i]
            edges = list(zip(cycle, cycle[1:] + cycle[:1]))
            pols = [self.G[u][v]["polarity"] for u, v in edges]
            ltype = "?" if "?" in pols else ("B" if pols.count("-") % 2 else "R")
            if not d:
                counters[ltype] += 1
            loops.append({
                "id": d.get("id") or f"{ltype}{counters[ltype]}",
                "type": ltype,
                "name": d.get("name"),
                "narrative": d.get("narrative"),
                "variables": cycle,
                "edges": edges,
            })
        return loops

    def find_loops(self, query: str) -> list[dict]:
        q, spans = _norm(query), _spans(query)
        for loop in self.loops:
            if _norm(loop["id"]) in spans:
                return [loop]
            if loop["name"] and _norm(loop["name"]) in q:
                return [loop]
        words = query.lower()
        cands = self.loops
        if "reinforc" in words:
            cands = [l for l in cands if l["type"] == "R"]
        elif "balanc" in words:
            cands = [l for l in cands if l["type"] == "B"]
        mentioned = {vid for name, vid in self.names.items() if name in words}
        if mentioned:
            narrowed = [l for l in cands if mentioned & set(l["variables"])]
            cands = narrowed or cands
        return cands

    def loop_summary(self, loop: dict) -> dict:
        return {
            "id": loop["id"],
            "type": TYPE_WORDS[loop["type"]],
            "name": loop["name"],
            "variables": [self.label(v) for v in loop["variables"]],
        }

    # ---------- tool responses ----------
    def overview(self) -> dict:
        ov = self.data.get("overview", {})
        loop_count = {vid: 0 for vid in self.vars}
        for loop in self.loops:
            for vid in loop["variables"]:
                loop_count[vid] += 1
        key = sorted(self.vars, key=lambda v: loop_count[v], reverse=True)[:3]
        return {
            "title": self.data["title"],
            "summary": ov.get("short") or self.data.get("description", ""),
            "verified_by_instructor": self.data.get("verified", False),
            "number_of_variables": len(self.vars),
            "loops": [self.loop_summary(l) for l in self.loops],
            "key_variables": [self.label(v) for v in key if loop_count[v] > 0],
            "has_behavior_over_time_graph": bool(self.data.get("behavior_graphs")),
        }

    def variable(self, name: str) -> dict:
        ids = self.resolve(name)
        if not ids:
            return {"error": f"No variable matches '{name}'.",
                    "available_variables": [v["label"] for v in self.vars.values()]}
        if len(ids) > 1:
            return {"ambiguous": True, "ask_student_which_one": [self.label(i) for i in ids]}
        vid = ids[0]
        v = self.vars[vid]
        return {
            "variable": v["label"],
            "kind": v.get("kind", "variable"),
            "description": v.get("description"),
            "affected_by": [
                {"variable": self.label(u), "effect": self.effect_phrase(u, vid),
                 "has_delay": self.G[u][vid]["delay"]}
                for u in self.G.predecessors(vid)
            ],
            "affects": [
                {"variable": self.label(w), "effect": self.effect_phrase(vid, w),
                 "has_delay": self.G[vid][w]["delay"]}
                for w in self.G.successors(vid)
            ],
            "part_of_loops": [self.loop_summary(l) for l in self.loops if vid in l["variables"]],
        }

    def loop(self, query: str) -> dict:
        found = self.find_loops(query)
        if not found:
            return {"error": "This model has no feedback loops."}
        if len(found) > 1:
            return {"ambiguous": True,
                    "ask_student_which_one": [self.loop_summary(l) for l in found]}
        loop = found[0]
        steps = [self.effect_phrase(u, v) + (" This takes time (delay)." if self.G[u][v]["delay"] else "")
                 for u, v in loop["edges"]]
        meaning = {
            "R": "This is a reinforcing loop: a change keeps amplifying itself, causing growth or collapse.",
            "B": "This is a balancing loop: it pushes back against change and moves the system toward a limit.",
            "?": "The loop type is unknown because at least one link's sign is unclear.",
        }[loop["type"]]
        return {
            **self.loop_summary(loop),
            "steps_in_order": steps,
            "closes_back_to": self.label(loop["variables"][0]),
            "what_it_means": meaning,
            "author_explanation": loop["narrative"],
        }

    def path(self, from_name: str, to_name: str) -> dict:
        a, b = self.resolve(from_name), self.resolve(to_name)
        if len(a) != 1 or len(b) != 1:
            return {"ambiguous_or_missing": True,
                    "from_matches": [self.label(i) for i in a],
                    "to_matches": [self.label(i) for i in b]}
        paths = sorted(nx.all_simple_paths(self.G, a[0], b[0], cutoff=6), key=len)[:3]
        if not paths:
            return {"connected": False,
                    "message": f"{self.label(a[0])} does not affect {self.label(b[0])} in this model."}
        out = []
        for p in paths:
            pols = [self.G[u][v]["polarity"] for u, v in zip(p, p[1:])]
            net = "unclear" if "?" in pols else ("goes down" if pols.count("-") % 2 else "goes up")
            out.append({
                "chain": [self.label(x) for x in p],
                "steps": [self.effect_phrase(u, v) for u, v in zip(p, p[1:])],
                "overall": f"If {self.label(p[0])} goes up, {self.label(p[-1])} {net} through this chain.",
            })
        return {"connected": True, "paths": out}

    def behavior(self) -> dict:
        graphs = self.data.get("behavior_graphs", [])
        if not graphs:
            return {"error": "This model has no behavior-over-time graph."}
        return {"graphs": graphs}

    def layout(self) -> dict:
        return {"layout": self.data.get("layout_description",
                                        "No layout information was recorded for this diagram.")}


def load_models() -> dict[str, ModelGraph]:
    return {
        path.stem: ModelGraph(json.loads(path.read_text()))
        for path in sorted(MODELS_DIR.glob("*.json"))
    }
