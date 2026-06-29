"""
Versocurio — Image Generator from Timestamped Narration
Reads a plain timestamped narration file, builds an image prompt per line
using Gemini text model, then generates one image per timestamp.
API keys loaded from .env — never hardcoded.

Usage:
    python generate_images.py narration.txt [--output ./output] [--model MODEL] [--characters NAMES]

Timestamped narration format (one line per timestamp):
    [00:00] ¿Qué pasaría si el Gamer no pudiera apagar la computadora nunca más?
    [00:03] Suena divertido. Pero nadie le dijo lo que vendría después.
    ...

Available image models:
    Hugging Face (HF_API_KEY required):
    flux-schnell                  — FLUX.1-schnell, fast (default)
    flux-dev                      — FLUX.1-dev, higher quality

    Gemini native (GEMINI_API_KEY, free tier limited):
    gemini-2.5-flash-image
    nano-banana-pro-preview
    gemini-3.1-flash-image

    Imagen API (GEMINI_API_KEY, paid plan required):
    imagen-4.0-generate-001
    imagen-4.0-ultra-generate-001

Character flags (comma-separated, default: all three):
    --characters gamer,mecanico,repartidor
"""

import argparse
import io
import os
import re
import sys
import time
from pathlib import Path

import requests
from dotenv import load_dotenv
from google import genai
from google.genai import types
from PIL import Image

load_dotenv()

# Matches [MM:SS] or (M:SS) or (MM:SS) anywhere in the line
TIMESTAMP_RE = re.compile(r"[\[\(](\d{1,2}:\d{2})[\]\)]")

# Gemini Imagen models (use generate_images API)
IMAGEN_MODELS = {
    "imagen-4.0-generate-001",
    "imagen-4.0-ultra-generate-001",
    "imagen-4.0-fast-generate-001",
    "imagen-3.0-generate-002",
}

# Hugging Face model aliases → HF model IDs
HF_MODELS = {
    "flux-schnell": "black-forest-labs/FLUX.1-schnell",
    "flux-dev":     "black-forest-labs/FLUX.1-dev",
}

DEFAULT_MODEL = "flux-schnell"

HF_API_URL = "https://api-inference.huggingface.co/models/{model}"

# ─── Character reference strings ─────────────────────────────────────────────

CHARACTERS = {
    "gamer": (
        "El Gamer: voxel/Minecraft-style blocky 3D skeleton character, "
        "white blocky cubic skull with black hollow square eye sockets and fixed grin, "
        "flat red varsity jacket with white sleeves and white cuffs with red stripe trim, "
        "black chest panel with 'VERSOCURIO' in bold pixel ALL-CAPS white letters, "
        "green translucent skeletal ribcage and spine visible beneath jacket, "
        "green voxel skeleton legs and bare green bone feet fully exposed"
    ),
    "mecanico": (
        "El Mecánico: voxel/Minecraft-style blocky 3D skeleton character, "
        "white blocky cubic skull with black hollow square eye sockets and fixed grin, "
        "flat dark olive-gray tactical work jacket with cargo pockets, "
        "black chest patch reading 'VERSOCURIO' in bold pixel ALL-CAPS white letters, "
        "small wrench tool icon on left chest pocket, "
        "green translucent skeletal ribcage visible beneath jacket, "
        "green voxel skeleton legs and bare green bone feet fully exposed"
    ),
    "repartidor": (
        "El Repartidor: voxel/Minecraft-style blocky 3D skeleton character, "
        "white blocky cubic skull with black hollow square eye sockets and fixed grin, "
        "flat navy blue blazer over white shirt, flat light blue blocky tie, "
        "small rectangular name badge reading 'VERSOCURIO' on left lapel, "
        "green translucent skeletal ribcage and spine visible beneath shirt, "
        "green voxel skeleton legs and bare green bone feet fully exposed"
    ),
}

SCENE_SYSTEM_PROMPT = """\
You are an image prompt writer for a voxel/Minecraft-style 3D animation YouTube Shorts channel called Versocurio.

Given a line of Spanish narration with a timestamp, write ONE image generation prompt in English.

Rules:
- Start with: voxel/Minecraft-style blocky 3D render,
- Insert the full character reference string(s) for whichever character(s) appear in this scene
- Describe: the character's pose and body language (no facial expression changes — skull is always a fixed grin), the action or situation, the background environment (simple, minimal voxel props), any on-screen text or labels visible in scene, camera angle
- End with: 9:16 vertical aspect ratio, YouTube Shorts format, saturated colors, crisp voxel render, no gradients, no photorealism, no organic shapes, no hand-drawn style.
- Never describe motion or camera movement
- Keep it under 120 words
- Output ONLY the prompt — no explanations, no labels, no markdown

CHARACTER REFERENCE STRINGS (use verbatim when that character appears):
{character_refs}

If the narration line does not clearly indicate which character is present, use all available characters.
"""


def load_api_key(env_var: str, label: str) -> str:
    key = os.environ.get(env_var, "").strip()
    if not key:
        sys.exit(
            f"Error: {env_var} not set.\n"
            f"Add your {label} key to .env: {env_var}=your_key_here"
        )
    return key


def parse_narration(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")

    # Find all timestamp positions and extract text between them
    matches = list(TIMESTAMP_RE.finditer(text))
    if not matches:
        return []

    entries = []
    for i, match in enumerate(matches):
        ts = match.group(1).zfill(4)  # normalize "0:08" → "00:08", "1:06" → "01:06"
        # Normalize to MM:SS
        parts = ts.split(":")
        ts_normalized = f"{int(parts[0]):02d}:{parts[1]}"

        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        narration = text[start:end].strip()
        # Clean up leading/trailing punctuation artifacts
        narration = re.sub(r"\s+", " ", narration).strip()

        if narration:
            entries.append({"timestamp": ts_normalized, "narration": narration})

    return entries


def slug(timestamp: str) -> str:
    return timestamp.replace(":", "-")


def build_image_prompt(
    client: genai.Client,
    narration: str,
    timestamp: str,
    character_refs: str,
    max_retries: int = 5,
) -> str:
    system = SCENE_SYSTEM_PROMPT.format(character_refs=character_refs)
    backoff = 15
    for attempt in range(max_retries):
        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=f"[{timestamp}] {narration}",
                config=types.GenerateContentConfig(
                    system_instruction=system,
                    temperature=0.7,
                ),
            )
            return response.text.strip()
        except Exception as exc:
            msg = str(exc)
            if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                # extract suggested retry delay from error if present
                m = re.search(r"retry in (\d+)", msg)
                wait = int(m.group(1)) + 2 if m else backoff
                print(f"\n           → rate limited, waiting {wait}s...", end=" ", flush=True)
                time.sleep(wait)
                backoff = min(backoff * 2, 120)
            else:
                raise
    raise RuntimeError(f"Gemini prompt build failed after {max_retries} attempts.")


# ─── Image backends ───────────────────────────────────────────────────────────

def generate_via_hf(prompt: str, model_alias: str) -> bytes:
    hf_key = load_api_key("HF_API_KEY", "Hugging Face")
    model_id = HF_MODELS[model_alias]
    url = HF_API_URL.format(model=model_id)
    headers = {"Authorization": f"Bearer {hf_key}"}

    # FLUX.1-schnell produces 1024×1024 by default; we crop/pad to 9:16 (576×1024)
    payload = {
        "inputs": prompt,
        "parameters": {
            "width": 576,
            "height": 1024,
            "num_inference_steps": 4,   # schnell is optimized for 1-4 steps
            "guidance_scale": 0.0,      # schnell requires 0 CFG
        },
    }

    for attempt in range(3):
        resp = requests.post(url, headers=headers, json=payload, timeout=120)

        if resp.status_code == 200:
            # Response is raw image bytes
            return resp.content

        if resp.status_code == 503:
            # Model loading — wait and retry
            wait = int(resp.headers.get("X-Wait-For-Model", "20"))
            print(f"\n           → model loading, waiting {wait}s...", end=" ", flush=True)
            time.sleep(wait)
            continue

        raise RuntimeError(f"HF API {resp.status_code}: {resp.text[:300]}")

    raise RuntimeError("HF API failed after 3 attempts (model still loading).")


def generate_via_imagen(client: genai.Client, prompt: str, model: str) -> bytes:
    response = client.models.generate_images(
        model=model,
        prompt=prompt,
        config=types.GenerateImagesConfig(
            number_of_images=1,
            aspect_ratio="9:16",
        ),
    )
    return response.generated_images[0].image.image_bytes


def generate_via_gemini_native(client: genai.Client, prompt: str, model: str) -> bytes:
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=types.GenerateContentConfig(
            response_modalities=["IMAGE", "TEXT"],
        ),
    )
    for part in response.candidates[0].content.parts:
        if part.inline_data:
            return part.inline_data.data
    raise RuntimeError("No image in response. Model may not support image output.")


def generate_image(client: genai.Client, prompt: str, model: str) -> bytes:
    if model in HF_MODELS:
        return generate_via_hf(prompt, model)
    if model in IMAGEN_MODELS:
        return generate_via_imagen(client, prompt, model)
    return generate_via_gemini_native(client, prompt, model)


# ─── Main ─────────────────────────────────────────────────────────────────────

def run(narration_file: Path, output_dir: Path, model: str, character_names: list[str]) -> None:
    gemini_key = load_api_key("GEMINI_API_KEY", "Gemini")
    client = genai.Client(api_key=gemini_key)

    output_dir.mkdir(parents=True, exist_ok=True)

    entries = parse_narration(narration_file)
    if not entries:
        sys.exit(
            "No timestamp lines found. Expected format:\n"
            "  [00:00] Narration text here\n"
            "  [00:03] Next line here"
        )

    missing = [n for n in character_names if n not in CHARACTERS]
    if missing:
        sys.exit(f"Unknown character(s): {missing}. Valid: {list(CHARACTERS)}")

    character_refs = "\n\n".join(CHARACTERS[n] for n in character_names)

    backend = "Hugging Face" if model in HF_MODELS else "Gemini"
    print(f"Backend    : {backend}")
    print(f"Model      : {model}{' (' + HF_MODELS[model] + ')' if model in HF_MODELS else ''}")
    print(f"Characters : {', '.join(character_names)}")
    print(f"Timestamps : {len(entries)}")
    print(f"Output     : {output_dir}/\n")

    log_lines = []

    for i, entry in enumerate(entries, 1):
        ts = entry["timestamp"]
        narration = entry["narration"]
        out_path = output_dir / f"{slug(ts)}.png"

        preview = narration[:60] + ("..." if len(narration) > 60 else "")
        print(f"  [{i}/{len(entries)}] [{ts}] {preview}")

        if out_path.exists():
            print(f"           → already exists, skipping\n")
            continue

        # Step 1: build image prompt via Gemini text model
        print(f"           → building prompt...", end=" ", flush=True)
        try:
            image_prompt = build_image_prompt(client, narration, ts, character_refs)
            print("done")
            log_lines.append(f"[{ts}]\nNARRATION: {narration}\nPROMPT: {image_prompt}\n")
        except Exception as exc:
            print(f"FAILED — {exc}\n")
            continue

        # Step 2: generate image
        print(f"           → generating image...", end=" ", flush=True)
        try:
            image_bytes = generate_image(client, image_prompt, model)
            out_path.write_bytes(image_bytes)
            print(f"saved → {out_path.name}\n")
        except Exception as exc:
            print(f"FAILED — {exc}\n")

        if i < len(entries):
            time.sleep(1.0)

    if log_lines:
        log_path = output_dir / "generated_prompts.txt"
        log_path.write_text("\n".join(log_lines), encoding="utf-8")
        print(f"Prompts logged → {log_path}")

    print("\nDone.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate voxel images from a Versocurio timestamped narration file."
    )
    parser.add_argument(
        "narration_file",
        type=Path,
        help="Path to timestamped narration .txt file",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("output"),
        help="Output directory for generated PNG images (default: ./output)",
    )
    parser.add_argument(
        "--model",
        default=DEFAULT_MODEL,
        help=(
            f"Image model to use (default: {DEFAULT_MODEL}). "
            "HF options: flux-schnell, flux-dev. "
            "Gemini options: gemini-2.5-flash-image, imagen-4.0-generate-001."
        ),
    )
    parser.add_argument(
        "--characters",
        default="gamer,mecanico,repartidor",
        help="Comma-separated character names: gamer, mecanico, repartidor (default: all three)",
    )
    args = parser.parse_args()

    if not args.narration_file.is_file():
        sys.exit(f"File not found: {args.narration_file}")

    character_names = [c.strip().lower() for c in args.characters.split(",")]
    run(args.narration_file, args.output, args.model, character_names)


if __name__ == "__main__":
    main()
