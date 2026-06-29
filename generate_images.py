"""
Generate images for YouTube Shorts from a timestamped script.

Usage:
    python generate_images.py <script_file>

Script file format (txt):
    00:00 Texto de la escena uno
    00:05 Texto de la escena dos
    ...

Each line becomes one image. The green skeleton avatar (VERSOCURIO style)
is automatically injected into every prompt.
"""

import os
import re
import sys
import json
from pathlib import Path
from dotenv import load_dotenv

load_dotenv()

try:
    from google import genai
    from google.genai import types
except ImportError:
    print("Error: instala las dependencias con: pip install -r requirements.txt")
    sys.exit(1)


SKELETON_STYLE = (
    "voxel art style, green translucent skeleton character with blue jacket, "
    "skull head with black headphones, pixel art aesthetic, 3D rendered, "
    "vibrant colors, dark humorous tone, YouTube Shorts vertical format 9:16"
)

PROMPT_SYSTEM = """Eres un director de arte para un canal de YouTube Shorts viral llamado VERSOCURIO.
El canal trata sobre curiosidades históricas y relatos narrados por un esqueleto verde animado.
Para cada escena descrita, crea un prompt de imagen en inglés que:
1. Incluya al personaje esqueleto verde como narrador/presentador en escena
2. Muestre visualmente el contenido de la escena
3. Sea dramático y llamativo para captar atención en los primeros segundos
4. Use estilo voxel art 3D, colores vibrantes
5. Sea adecuado para formato vertical 9:16 (YouTube Shorts)

Responde SOLO con el prompt en inglés, sin explicaciones adicionales."""


def parse_timestamps(filepath: str) -> list[dict]:
    """Parse a timestamped script file into scenes."""
    scenes = []
    pattern = re.compile(r'^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$')

    with open(filepath, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#'):
                continue
            m = pattern.match(line)
            if m:
                scenes.append({'timestamp': m.group(1), 'text': m.group(2)})
            else:
                # Line without timestamp — append to last scene
                if scenes:
                    scenes[-1]['text'] += ' ' + line

    return scenes


def generate_image_prompt(client: genai.Client, scene_text: str) -> str:
    """Ask Gemini to turn a scene description into an image prompt."""
    response = client.models.generate_content(
        model='gemini-2.0-flash',
        contents=scene_text,
        config=types.GenerateContentConfig(
            system_instruction=PROMPT_SYSTEM,
            temperature=0.9,
            max_output_tokens=300,
        ),
    )
    return response.text.strip()


def generate_image(client: genai.Client, prompt: str, output_path: str) -> bool:
    """Generate an image using Imagen 3 and save it."""
    full_prompt = f"{prompt}, {SKELETON_STYLE}"

    response = client.models.generate_images(
        model='imagen-3.0-generate-002',
        prompt=full_prompt,
        config=types.GenerateImagesConfig(
            number_of_images=1,
            aspect_ratio='9:16',
            safety_filter_level='block_only_high',
        ),
    )

    if not response.generated_images:
        return False

    image_data = response.generated_images[0].image.image_bytes
    with open(output_path, 'wb') as f:
        f.write(image_data)
    return True


def process_script(script_file: str):
    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        print("Error: GEMINI_API_KEY no encontrada en .env")
        sys.exit(1)

    client = genai.Client(api_key=api_key)

    scenes = parse_timestamps(script_file)
    if not scenes:
        print("No se encontraron escenas en el archivo.")
        sys.exit(1)

    print(f"Encontradas {len(scenes)} escenas en '{script_file}'")

    script_name = Path(script_file).stem
    output_dir = Path('output') / script_name
    output_dir.mkdir(parents=True, exist_ok=True)

    results = []

    for i, scene in enumerate(scenes, 1):
        ts = scene['timestamp'].replace(':', '-')
        print(f"\n[{i}/{len(scenes)}] {scene['timestamp']} — {scene['text'][:60]}...")

        print("  Generando prompt con Gemini...")
        try:
            image_prompt = generate_image_prompt(client, scene['text'])
            print(f"  Prompt: {image_prompt[:80]}...")
        except Exception as e:
            print(f"  Error generando prompt: {e}")
            continue

        image_path = str(output_dir / f"{i:02d}_{ts}.png")
        print(f"  Generando imagen con Imagen 3...")
        try:
            ok = generate_image(client, image_prompt, image_path)
            if ok:
                print(f"  Guardada: {image_path}")
            else:
                print("  Error: no se generó imagen.")
        except Exception as e:
            print(f"  Error generando imagen: {e}")
            image_path = None

        results.append({
            'index': i,
            'timestamp': scene['timestamp'],
            'text': scene['text'],
            'prompt': image_prompt,
            'image': image_path,
        })

    # Save manifest
    manifest_path = output_dir / 'manifest.json'
    with open(manifest_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    print(f"\nListo. {len(results)} escenas procesadas.")
    print(f"Imágenes en: {output_dir}/")
    print(f"Manifiesto: {manifest_path}")


if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Uso: python generate_images.py <archivo_script.txt>")
        print("\nFormato del archivo:")
        print("  00:00 El esqueleto aparece en una isla desierta")
        print("  00:05 Mira alrededor buscando comida")
        print("  00:10 Encuentra una palmera con cocos")
        sys.exit(0)

    process_script(sys.argv[1])
