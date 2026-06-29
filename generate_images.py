"""
Versocurio — Gemini Image Generator
Reads a timestamped prompts file and generates one image per timestamp.
API key is loaded from .env — never hardcoded.

Usage:
    python generate_images.py prompts_[tema].txt [--output ./output] [--model MODEL]

Available image models:
  Imagen API (requires paid plan):
    imagen-4.0-generate-001       — best quality  (default)
    imagen-4.0-ultra-generate-001 — highest quality, slower
    imagen-4.0-fast-generate-001  — fastest

  Gemini native image generation (free tier, limited RPD):
    gemini-2.5-flash-image        — fast, free tier
    nano-banana-pro-preview       — Versocurio channel model alias
    gemini-3.1-flash-image        — stable release
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

TIMESTAMP_RE = re.compile(r"^\[(\d{2}:\d{2})\]")
NANO_BANANA_RE = re.compile(
    r"NANO BANANA 2(?:\s+\(FIRST FRAME\))?:\s*(.+)", re.DOTALL
)

# Models that use generate_images() — all others use generate_content()
IMAGEN_MODELS = {
    "imagen-4.0-generate-001",
    "imagen-4.0-ultra-generate-001",
    "imagen-4.0-fast-generate-001",
    "imagen-3.0-generate-002",
}

DEFAULT_MODEL = "imagen-4.0-generate-001"


def load_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        sys.exit(
            "Error: GEMINI_API_KEY not set.\n"
            "Copy .env.example to .env and add your key."
        )
    return key


def parse_prompts(path: Path) -> list[dict]:
    """
    Parse a prompts file produced by the Versocurio master prompt (Stage 3).
    Returns a list of {timestamp, type, prompt} dicts.
    """
    text = path.read_text(encoding="utf-8")
    blocks = re.split(r"(?=^\[\d{2}:\d{2}\])", text, flags=re.MULTILINE)

    entries = []
    for block in blocks:
        block = block.strip()
        if not block:
            continue
        ts_match = TIMESTAMP_RE.match(block)
        if not ts_match:
            continue
        timestamp = ts_match.group(1)

        kind = "ANIMATED" if "ANIMATED" in block else "STATIC"

        nano_match = NANO_BANANA_RE.search(block)
        if not nano_match:
            print(f"  [skip] {timestamp} — no NANO BANANA 2 prompt found")
            continue

        # Strip any trailing VEO 3 section that may have bled in
        nano_prompt = nano_match.group(1).split("VEO 3:")[0].strip()

        entries.append(
            {"timestamp": timestamp, "type": kind, "prompt": nano_prompt}
        )

    return entries


def slug(timestamp: str) -> str:
    return timestamp.replace(":", "-")


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


def run(prompts_file: Path, output_dir: Path, model: str) -> None:
    api_key = load_api_key()
    client = genai.Client(api_key=api_key)

    output_dir.mkdir(parents=True, exist_ok=True)

    entries = parse_prompts(prompts_file)
    if not entries:
        sys.exit("No valid timestamp blocks found in the file.")

    print(f"Model  : {model}")
    print(f"Output : {output_dir}/")
    print(f"Frames : {len(entries)}\n")

    for i, entry in enumerate(entries, 1):
        ts = entry["timestamp"]
        out_path = output_dir / f"{slug(ts)}.png"

        if out_path.exists():
            print(f"  [{i}/{len(entries)}] {ts} — already exists, skipping")
            continue

        print(f"  [{i}/{len(entries)}] {ts} ({entry['type']}) — generating...", end=" ", flush=True)
        try:
            image_bytes = generate_image(client, entry["prompt"], model)
            out_path.write_bytes(image_bytes)
            print(f"saved → {out_path.name}")
        except Exception as exc:
            print(f"FAILED — {exc}")

        if i < len(entries):
            time.sleep(1.5)

    print("\nDone.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate voxel images from a Versocurio timestamped prompts file."
    )
    parser.add_argument(
        "prompts_file",
        type=Path,
        help="Path to the prompts_[tema].txt file from Stage 3",
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
        help=f"Gemini image model (default: {DEFAULT_MODEL}). "
             "Use gemini-2.5-flash-image or nano-banana-pro-preview for free tier.",
    )
    args = parser.parse_args()

    if not args.prompts_file.is_file():
        sys.exit(f"File not found: {args.prompts_file}")

    run(args.prompts_file, args.output, args.model)


if __name__ == "__main__":
    main()
