import os
os.environ["TOOL_SECRET"] = "test-secret"

from fastapi.testclient import TestClient
import server

server.TOOL_SECRET = "test-secret"
client = TestClient(server.app)
H = {"X-Tool-Secret": "test-secret"}


def test_rejects_missing_secret():
    assert client.post("/tools/get_overview", json={"model_id": "deer-population"}).status_code == 401


def test_overview():
    r = client.post("/tools/get_overview", json={"model_id": "deer-population"}, headers=H)
    assert r.status_code == 200
    assert len(r.json()["loops"]) == 2


def test_unknown_model_is_spoken_error_not_crash():
    r = client.post("/tools/get_overview", json={"model_id": "nope"}, headers=H)
    assert r.status_code == 200 and "error" in r.json()


def test_loop_tool():
    r = client.post("/tools/get_loop", json={"model_id": "water-supply", "query": "B four point one"}, headers=H)
    assert r.json()["id"] == "B4.1"
