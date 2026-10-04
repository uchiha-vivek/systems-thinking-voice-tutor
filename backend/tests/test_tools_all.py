"""Every tool endpoint, end to end over HTTP, with the answers the Checkpoint 4 script expects."""
import os
os.environ["TOOL_SECRET"] = "test-secret"

import pytest
from fastapi.testclient import TestClient
import server

server.TOOL_SECRET = "test-secret"
client = TestClient(server.app)
H = {"X-Tool-Secret": "test-secret"}

TOOL_BODIES = {
    "get_overview": {"model_id": "deer-population"},
    "get_variable": {"model_id": "deer-population", "name": "births"},
    "get_loop": {"model_id": "deer-population", "query": "the reinforcing loop"},
    "find_path": {"model_id": "deer-population", "from_name": "births", "to_name": "deaths"},
    "get_behavior": {"model_id": "deer-population"},
    "get_layout": {"model_id": "deer-population"},
}


def tool(name, body):
    r = client.post(f"/tools/{name}", json=body, headers=H)
    assert r.status_code == 200, r.text
    return r.json()


# ---------- security ----------
@pytest.mark.parametrize("name", TOOL_BODIES)
def test_every_tool_rejects_missing_secret(name):
    assert client.post(f"/tools/{name}", json=TOOL_BODIES[name]).status_code == 401


@pytest.mark.parametrize("name", TOOL_BODIES)
def test_every_tool_rejects_wrong_secret(name):
    r = client.post(f"/tools/{name}", json=TOOL_BODIES[name], headers={"X-Tool-Secret": "nope"})
    assert r.status_code == 401


def test_tools_closed_when_server_has_no_secret(monkeypatch):
    monkeypatch.setattr(server, "TOOL_SECRET", "")
    r = client.post("/tools/get_overview", json={"model_id": "deer-population"}, headers={"X-Tool-Secret": ""})
    assert r.status_code == 401


@pytest.mark.parametrize("name", TOOL_BODIES)
def test_every_tool_answers_unknown_model_with_spoken_error(name):
    body = {**TOOL_BODIES[name], "model_id": "nope"}
    r = tool(name, body)
    assert "error" in r and r["available_models"] == ["deer-population", "water-supply"]


def test_missing_parameter_is_rejected():
    r = client.post("/tools/get_variable", json={"model_id": "deer-population"}, headers=H)
    assert r.status_code == 422


# ---------- Checkpoint 4: deer ----------
def test_deer_overview():
    r = tool("get_overview", {"model_id": "deer-population"})
    assert r["title"] == "Deer Population"
    assert r["verified_by_instructor"] is True
    assert sorted(l["type"] for l in r["loops"]) == ["balancing", "reinforcing"]
    assert r["has_behavior_over_time_graph"] is True


def test_deer_reinforcing_loop_walkthrough():
    r = tool("get_loop", {"model_id": "deer-population", "query": "walk me through the reinforcing loop"})
    assert r["type"] == "reinforcing"
    assert r["steps_in_order"] == [
        "When Deer population goes up, Deer births per year goes up.",
        "When Deer births per year goes up, Deer population goes up.",
    ]
    assert r["closes_back_to"] == "Deer population"


def test_deer_balancing_loop_pushes_back():
    r = tool("get_loop", {"model_id": "deer-population", "query": "the deaths loop"})
    assert r["type"] == "balancing"
    assert "When Deer deaths per year goes up, Deer population goes down." in r["steps_in_order"]


def test_what_affects_deer_population():
    r = tool("get_variable", {"model_id": "deer-population", "name": "deer population"})
    effects = {a["variable"]: a["effect"] for a in r["affected_by"]}
    assert effects["Deer births per year"].endswith("Deer population goes up.")
    assert effects["Deer deaths per year"].endswith("Deer population goes down.")


def test_births_up_means_deaths_up():
    r = tool("find_path", {"model_id": "deer-population", "from_name": "births", "to_name": "deaths"})
    assert r["connected"]
    assert r["paths"][0]["chain"] == ["Deer births per year", "Deer population", "Deer deaths per year"]
    assert "Deer deaths per year goes up" in r["paths"][0]["overall"]


def test_deer_behavior_over_time():
    r = tool("get_behavior", {"model_id": "deer-population"})
    assert "Births stay ahead of deaths" in r["graphs"][0]["key_insight"]


def test_deer_layout_says_balancing_loop_on_right():
    r = tool("get_layout", {"model_id": "deer-population"})
    assert "right with the balancing loop" in r["layout"]


def test_unknown_variable_lists_real_ones():
    r = tool("get_variable", {"model_id": "deer-population", "name": "wolves"})
    assert "error" in r
    assert r["available_variables"] == ["Deer population", "Deer births per year", "Deer deaths per year"]


# ---------- Checkpoint 4: water ----------
def test_water_overview_flags_unverified_and_five_loops():
    r = tool("get_overview", {"model_id": "water-supply"})
    assert r["verified_by_instructor"] is False
    assert len(r["loops"]) == 5


def test_demand_is_ambiguous():
    r = tool("get_variable", {"model_id": "water-supply", "name": "demand"})
    assert r["ambiguous"] is True
    assert set(r["ask_student_which_one"]) == {"Informal demand", "Formal demand"}


def test_water_b_three_point_one():
    r = tool("get_loop", {"model_id": "water-supply", "query": "walk me through B three point one"})
    assert r["id"] == "B3.1" and r["type"] == "balancing"
    assert r["variables"] == ["Informal demand", "Total expenditure on water supply per household", "Household income"]


def test_informal_demand_up_means_income_down():
    r = tool("find_path", {"model_id": "water-supply", "from_name": "informal demand", "to_name": "household income"})
    assert "Household income goes down" in r["paths"][0]["overall"]


def test_delay_is_spoken_in_rehab_loop():
    r = tool("get_loop", {"model_id": "water-supply", "query": "B four point one"})
    assert any("This takes time (delay)." in s for s in r["steps_in_order"])


def test_water_has_no_layout_and_says_so():
    r = tool("get_layout", {"model_id": "water-supply"})
    assert r["layout"] == "No layout information was recorded for this diagram."


def test_unconnected_variables():
    r = tool("find_path", {"model_id": "water-supply", "from_name": "household income", "to_name": "population"})
    assert r["connected"] is False


# ---------- page endpoints ----------
def test_page_endpoints():
    assert client.get("/health").json() == {"ok": True, "models": ["deer-population", "water-supply"]}
    assert client.get("/api/models").json() == [
        {"id": "deer-population", "title": "Deer Population"},
        {"id": "water-supply", "title": "Formal and Informal Water Supply"},
    ]
    assert "agent_id" in client.get("/api/config").json()
