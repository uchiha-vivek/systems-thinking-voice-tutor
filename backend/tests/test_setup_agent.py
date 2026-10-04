"""The webhook tool payloads setup_agent.py sends to ElevenLabs, checked against what the server accepts."""
import importlib.util
import os
from pathlib import Path

import pytest

import server

SCRIPT = Path(__file__).parents[2] / "scripts" / "setup_agent.py"


def load_script(base_url="https://tutor.example.ngrok-free.dev/"):
    os.environ.update({
        "ELEVENLABS_API_KEY": "test-key",
        "ELEVENLABS_AGENT_ID": "agent_test",
        "PUBLIC_BASE_URL": base_url,
        "TOOL_SECRET": "test-secret",
    })
    spec = importlib.util.spec_from_file_location("setup_agent", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture
def clean_env():
    saved = {k: os.environ.get(k) for k in ("ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "PUBLIC_BASE_URL", "TOOL_SECRET")}
    yield
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


@pytest.fixture
def script(clean_env):
    return load_script()


def configs(script):
    return {name: script.tool_config(name, desc, props) for name, desc, props in script.TOOLS}


def test_defines_exactly_the_six_server_tools(script):
    server_tools = {r.path.removeprefix("/tools/") for r in server.app.routes if r.path.startswith("/tools/")}
    assert set(configs(script)) == server_tools


def test_each_tool_posts_to_its_url_with_the_secret(script):
    for name, cfg in configs(script).items():
        api = cfg["api_schema"]
        assert cfg["type"] == "webhook"
        assert api["url"] == f"https://tutor.example.ngrok-free.dev/tools/{name}"  # trailing slash stripped
        assert api["method"] == "POST"
        assert api["request_headers"] == {"X-Tool-Secret": "test-secret"}


def test_every_parameter_is_required_and_described(script):
    for name, cfg in configs(script).items():
        body = cfg["api_schema"]["request_body_schema"]
        assert body["required"] == list(body["properties"])
        assert "model_id" in body["properties"]
        for prop in body["properties"].values():
            assert prop["type"] == "string" and prop["description"]


def test_parameters_match_the_server_request_models(script):
    expected = {
        "get_overview": server.ModelReq, "get_behavior": server.ModelReq, "get_layout": server.ModelReq,
        "get_variable": server.VariableReq, "get_loop": server.LoopReq, "find_path": server.PathReq,
    }
    for name, cfg in configs(script).items():
        props = cfg["api_schema"]["request_body_schema"]["properties"]
        assert set(props) == set(expected[name].model_fields), name


def test_prompt_and_first_message_use_the_dynamic_variables(script):
    assert '"{{model_id}}"' in script.SYSTEM_PROMPT
    assert "{{model_title}}" in script.FIRST_MESSAGE


def test_refuses_a_non_https_tunnel_url(clean_env):
    with pytest.raises(SystemExit, match="https"):
        load_script("http://localhost:8000")
