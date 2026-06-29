"""
Versocurio — Image Generator from Timestamped Narration
Reads a plain timestamped narration file, builds an image prompt per line
using Gemini text model, then generates one image per timestamp.
API key loaded from .env — never hardcoded.

Usage:
    python generate_images.py narration.txt [--output ./output] [--model MODEL] [--characters NAMES]

Timestamped narration format (one line per timestamp):
    [00:00] ¿Qué pasaría si el Gamer no pudiera apagar la computadora nunca más?
    [00:03] Suena divertido. Pero nadie le dijo lo que vendría después.
    ...

Available image models:
    gemini-2.5-flash-image        — free tier (default)
    nano-banana-pro-preview       — Versocurio channel model
    gemini-3.1-flash-image        — stable release
    imagen-4.0-generate-001       — best quality (paid plan required)
    imagen-4.0-ultra-generate-001 — highest quality (paid plan required)

Character flags (comma-separated, default: all three):
    --characters gamer,mecanico,repartidor
"""

import argparse
import os
import re
import sys
import time
from pathlib import Path

from dotenv import load_dotenv
from google import genai
from google.genai import types

load_dotenv()

TIMESTAMP_RE = re.compile(r"^\[(\d{2}:\d{2})\]\s*(.+)", re.MULTILINE)

IMAGEN_MODELS = {
    "imagen-4.0-generate-001",
    "imagen-4.0-ultra-generate-001",
    "imagen-4.0-fast-generate-001",
    "imagen-3.0-generate-002",
}

DEFAULT_MODEL = "gemini-2.5-flash-image"

# ─── Character reference strings (built from actual character designs) ────────

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


def load_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        sys.exit(
            "Error: GEMINI_API_KEY not set.\n"
            "Copy .env.example to .env and add your key."
        )
    return key


def parse_narration(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    entries = []
    for match in TIMESTAMP_RE.finditer(text):
        entries.append({
            "timestamp": match.group(1),
            "narration": match.group(2).strip(),
        })
    return entries


def slug(timestamp: str) -> str:
    return timestamp.replace(":", "-")


def build_image_prompt(
    client: genai.Client,
    narration: str,
    timestamp: str,
    character_refs: str,
) -> str:
    system = SCENE_SYSTEM_PROMPT.format(character_refs=character_refs)
    user_msg = f"[{timestamp}] {narration}"
    response = client.models.generate_content(
        model="gemini-2.5-flash",
        contents=user_msg,
        config=types.GenerateContentConfig(
            system_instruction=system,
            temperature=0.7,
        ),
    )
    return response.text.strip()


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


def generate_via_gemini(client: genai.Client, prompt: str, model: str) -> bytes:
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
    if model in IMAGEN_MODELS:
        return generate_via_imagen(client, prompt, model)
    return generate_via_gemini(client, prompt, model)


def run(narration_file: Path, output_dir: Path, model: str, character_names: list[str]) -> None:
    api_key = load_api_key()
    client = genai.Client(api_key=api_key)

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

    print(f"Model      : {model}")
    print(f"Characters : {', '.join(character_names)}")
    print(f"Timestamps : {len(entries)}")
    print(f"Output     : {output_dir}/\n")

    prompts_log = output_dir / "generated_prompts.txt"
    log_lines = []

    for i, entry in enumerate(entries, 1):
        ts = entry["timestamp"]
        narration = entry["narration"]
        out_path = output_dir / f"{slug(ts)}.png"

        print(f"  [{i}/{len(entries)}] [{ts}] {narration[:60]}{'...' if len(narration) > 60 else ''}")

        if out_path.exists():
            print(f"           → already exists, skipping\n")
            continue

        # Step 1: build image prompt from narration
        print(f"           → building prompt...", end=" ", flush=True)
        try:
            image_prompt = build_image_prompt(client, narration, ts, character_refs)
            print("done")
            log_lines.append(f"[{ts}]\nNARRATION: {narration}\nPROMPT: {image_prompt}\n")
        except Exception as exc:
            print(f"FAILED (prompt) — {exc}\n")
            continue

        # Step 2: generate image
        print(f"           → generating image...", end=" ", flush=True)
        try:
            image_bytes = generate_image(client, image_prompt, model)
            out_path.write_bytes(image_bytes)
            print(f"saved → {out_path.name}\n")
        except Exception as exc:
            print(f"FAILED (image) — {exc}\n")

        if i < len(entries):
            time.sleep(1.5)

    if log_lines:
        prompts_log.write_text("\n".join(log_lines), encoding="utf-8")
        print(f"Prompts logged → {prompts_log}")

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
        help=f"Gemini image model (default: {DEFAULT_MODEL})",
    )
    parser.add_argument(
        "--characters",
        default="gamer,mecanico,repartidor",
        help="Comma-separated character names to include: gamer, mecanico, repartidor (default: all three)",
    )
    args = parser.parse_args()

    if not args.narration_file.is_file():
        sys.exit(f"File not found: {args.narration_file}")

    character_names = [c.strip().lower() for c in args.characters.split(",")]
    run(args.narration_file, args.output, args.model, character_names)


if __name__ == "__main__":
    main()
