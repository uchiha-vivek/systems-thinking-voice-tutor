"""FastAPI server: webhook tools for the ElevenLabs agent + the student web page."""
import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from engine import load_models

load_dotenv(Path(__file__).parent.parent / ".env")
TOOL_SECRET = os.environ.get("TOOL_SECRET", "")
AGENT_ID = os.environ.get("ELEVENLABS_AGENT_ID", "")
FRONTEND = Path(__file__).parent.parent / "frontend"

MODELS = load_models()
app = FastAPI(title="Systems Thinking Voice Tutor")


def check_secret(x_tool_secret: str = Header(default="")):
    if not TOOL_SECRET or x_tool_secret != TOOL_SECRET:
        raise HTTPException(status_code=401, detail="bad tool secret")


def get_model(model_id: str):
    model = MODELS.get(model_id)
    if model is None:
        # 200 with an error body, so the agent can say something useful instead of failing
        return None
    return model


class ModelReq(BaseModel):
    model_id: str

class VariableReq(ModelReq):
    name: str

class LoopReq(ModelReq):
    query: str

class PathReq(ModelReq):
    from_name: str
    to_name: str


def run(model_id: str, fn):
    model = get_model(model_id)
    if model is None:
        return {"error": f"Unknown model '{model_id}'.", "available_models": list(MODELS)}
    return fn(model)


# ---------- webhook tools (called by ElevenLabs) ----------
@app.post("/tools/get_overview", dependencies=[Depends(check_secret)])
def tool_overview(req: ModelReq):
    return run(req.model_id, lambda m: m.overview())

@app.post("/tools/get_variable", dependencies=[Depends(check_secret)])
def tool_variable(req: VariableReq):
    return run(req.model_id, lambda m: m.variable(req.name))

@app.post("/tools/get_loop", dependencies=[Depends(check_secret)])
def tool_loop(req: LoopReq):
    return run(req.model_id, lambda m: m.loop(req.query))

@app.post("/tools/find_path", dependencies=[Depends(check_secret)])
def tool_path(req: PathReq):
    return run(req.model_id, lambda m: m.path(req.from_name, req.to_name))

@app.post("/tools/get_behavior", dependencies=[Depends(check_secret)])
def tool_behavior(req: ModelReq):
    return run(req.model_id, lambda m: m.behavior())

@app.post("/tools/get_layout", dependencies=[Depends(check_secret)])
def tool_layout(req: ModelReq):
    return run(req.model_id, lambda m: m.layout())


# ---------- student web page ----------
@app.get("/api/models")
def list_models():
    return [{"id": mid, "title": m.data["title"]} for mid, m in MODELS.items()]

@app.get("/api/config")
def config():
    return {"agent_id": AGENT_ID}

@app.get("/health")
def health():
    return {"ok": True, "models": list(MODELS)}

@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")
