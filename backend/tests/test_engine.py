from engine import load_models

MODELS = load_models()
DEER = MODELS["deer-population"]
WATER = MODELS["water-supply"]


def loop_types(model):
    return sorted((l["id"], l["type"]) for l in model.loops)


def test_deer_has_one_reinforcing_and_one_balancing_loop():
    assert loop_types(DEER) == [("B", "B"), ("R", "R")]


def test_water_loops_match_diagram():
    assert loop_types(WATER) == [
        ("B2.1", "B"), ("B3.1", "B"), ("B3.2", "B"), ("B4.1", "B"), ("R3.1", "R"),
    ]


def test_resolve_spoken_names():
    assert DEER.resolve("births") == ["deer_births"]
    assert DEER.resolve("the deer population") == ["deer_population"]
    assert WATER.resolve("HH income") == ["hh_income"]


def test_variable_lists_causes_and_effects():
    v = DEER.variable("deer population")
    assert {a["variable"] for a in v["affected_by"]} == {"Deer births per year", "Deer deaths per year"}
    assert {a["variable"] for a in v["affects"]} == {"Deer births per year", "Deer deaths per year"}


def test_loop_lookup_by_spoken_words():
    assert DEER.loop("the reinforcing loop")["id"] == "R"
    assert DEER.loop("walk me through the balancing loop")["id"] == "B"
    assert WATER.loop("B three point one")["id"] == "B3.1"
    assert WATER.loop("loop b3.2")["id"] == "B3.2"
    assert WATER.loop("the reinforcing loop")["id"] == "R3.1"
    assert WATER.loop("balancing loop").get("ambiguous") is True


def test_loop_walkthrough_closes_the_loop():
    w = DEER.loop("births loop")
    assert w["closes_back_to"] == "Deer population"
    assert len(w["steps_in_order"]) == 2


def test_path_net_effect():
    p = WATER.path("informal demand", "household income")
    assert p["connected"]
    assert "goes down" in p["paths"][0]["overall"]


def test_unknown_variable_lists_options():
    r = DEER.variable("wolves")
    assert "error" in r and "Deer population" in r["available_variables"]
