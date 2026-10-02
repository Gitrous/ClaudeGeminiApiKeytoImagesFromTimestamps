#!/usr/bin/env bash
# Pulls the latest version of the repo's default branch and restarts the
# static web server on port 8000. Run automatically by Codespaces on attach.
set -u
cd "$(dirname "$0")/.."

PORT=8000
LOG=/tmp/web-server.log

default_branch=$(git ls-remote --symref origin HEAD 2>/dev/null | awk '/^ref:/ {sub("refs/heads/", "", $2); print $2}')
default_branch=${default_branch:-main}

echo "▶ Actualizando desde la rama principal: $default_branch"
if git fetch origin "$default_branch"; then
  if [ "$(git rev-parse --abbrev-ref HEAD)" != "$default_branch" ]; then
    git checkout "$default_branch" 2>/dev/null || git checkout -b "$default_branch" "origin/$default_branch"
  fi
  # --ff-only never rewrites history; --autostash keeps local edits safe.
  git pull --ff-only --autostash origin "$default_branch" \
    || echo "⚠ No se pudo actualizar automáticamente (hay cambios locales que chocan). Se usa la versión actual."
else
  echo "⚠ Sin conexión con GitHub: se usa la versión actual."
fi

echo "▶ Reiniciando el servidor en el puerto $PORT"
# Anchored to the start of the command line so only the Python server matches.
pkill -f "^python3? -m http.server $PORT" 2>/dev/null || true
sleep 1
nohup setsid python3 -m http.server "$PORT" --bind 0.0.0.0 > "$LOG" 2>&1 < /dev/null &
sleep 1
if pgrep -f "^python3? -m http.server $PORT" > /dev/null; then
  echo "✔ Web lista en el puerto $PORT ($(git log --oneline -1))"
  echo "  Ábrela desde la pestaña Ports (puerto $PORT) y recarga con Ctrl+Shift+R."
else
  echo "✖ El servidor no arrancó. Mira el log: $LOG"
fi
