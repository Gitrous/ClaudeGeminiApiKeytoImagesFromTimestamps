"""
Local Stable Diffusion server for the Timestamps → Imágenes web app.

Adapted from templates/image-gen-api in free-ai-bible
(https://github.com/abbosaliboev/free-ai-bible, MIT License,
Copyright (c) 2026 Free AI Bible Contributors).

Changes from the template: serves the web app itself (same origin, so it
works behind Codespaces' private port forwarding), loads the model in the
background, returns PNG bytes, accepts a seed, and defaults to SD-Turbo,
which needs only 1-2 steps and is usable on CPU.

Run with: bash local-sd/start.sh   (or: uvicorn app:app --port 7860)
"""

import io
import os
import threading
from pathlib import Path

import torch
from diffusers import AutoPipelineForText2Image
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

MODEL = os.environ.get("SD_MODEL", "stabilityai/sd-turbo")
TURBO = "turbo" in MODEL.lower()
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SITE_DIR = Path(__file__).resolve().parent.parent

app = FastAPI(title="Stable Diffusion local")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def guard(request: Request, call_next):
    # Never serve dotfiles (.git, .venv...) from the static mount.
    if any(part.startswith(".") for part in request.url.path.split("/") if part):
        return Response(status_code=404)
    response = await call_next(request)
    # Lets https pages (e.g. GitHub Pages) call this server on localhost.
    response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


pipe = None
load_error = None
generate_lock = threading.Lock()


def load_model():
    global pipe, load_error
    try:
        print(f"⏳ Cargando {MODEL} en {DEVICE} (la primera vez se descarga, ~2-4 GB)…", flush=True)
        dtype = torch.float16 if DEVICE == "cuda" else torch.float32
        pipe = AutoPipelineForText2Image.from_pretrained(MODEL, torch_dtype=dtype).to(DEVICE)
        print("✅ Modelo listo", flush=True)
    except Exception as exc:  # surfaced to the web app via /sd/health and /sd/generate
        load_error = str(exc)
        print(f"✖ No se pudo cargar el modelo: {exc}", flush=True)


threading.Thread(target=load_model, daemon=True).start()


class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)
    negative_prompt: str = "blurry, low quality, distorted, text, watermark"
    width: int = Field(512, ge=256, le=1536)
    height: int = Field(512, ge=256, le=1536)
    steps: int | None = Field(None, ge=1, le=60)
    seed: int | None = None


@app.get("/sd/health")
def health():
    return {"ready": pipe is not None, "error": load_error, "model": MODEL, "device": DEVICE}


@app.post("/sd/generate")
def generate(req: GenerateRequest):
    if load_error:
        raise HTTPException(500, f"No se pudo cargar el modelo {MODEL}: {load_error}")
    if pipe is None:
        raise HTTPException(503, "El modelo todavía se está descargando o cargando")

    kwargs = {
        "prompt": req.prompt,
        "width": req.width // 8 * 8,
        "height": req.height // 8 * 8,
        "num_inference_steps": req.steps or (2 if TURBO else 25),
    }
    if TURBO:
        kwargs["guidance_scale"] = 0.0  # turbo models are trained without CFG
    else:
        kwargs["negative_prompt"] = req.negative_prompt
    if req.seed is not None:
        kwargs["generator"] = torch.Generator(device="cpu").manual_seed(req.seed)

    with generate_lock:  # one image at a time: the model is not thread-safe
        image = pipe(**kwargs).images[0]

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png")


# The web app itself, so page and API share one origin.
app.mount("/", StaticFiles(directory=SITE_DIR, html=True), name="site")
