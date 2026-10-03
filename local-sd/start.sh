#!/usr/bin/env bash
# Installs (first time only) and starts the local Stable Diffusion server,
# which also serves the web app. Open the printed port in your browser.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-7860}"

if [ ! -d .venv ]; then
  echo "▶ Creando entorno de Python (solo la primera vez)…"
  python3 -m venv .venv
fi
. .venv/bin/activate

if ! python -c "import torch" 2>/dev/null; then
  echo "▶ Instalando PyTorch (solo la primera vez)…"
  if command -v nvidia-smi >/dev/null 2>&1; then
    pip install torch
  else
    pip install torch --index-url https://download.pytorch.org/whl/cpu
  fi
fi
pip install -q -r requirements.txt

echo "▶ Servidor en el puerto $PORT. Abre la web desde ahí (en Codespaces: pestaña Ports → $PORT)."
echo "  Elige el motor «Stable Diffusion local». La primera imagen tarda: se descarga el modelo."
exec uvicorn app:app --host 0.0.0.0 --port "$PORT"
