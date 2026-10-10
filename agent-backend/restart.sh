#!/bin/sh

set -u

PORT="${PORT:-3000}"

check_port() {
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN -t 2>/dev/null || true
}

pids="$(check_port)"

if [ -n "$pids" ]; then
  echo "Stopping process(es) on port $PORT: $pids"
  for pid in $pids; do
    kill -TERM "$pid" 2>/dev/null || true
  done

  i=1
  while [ "$i" -le 20 ]; do
    if [ -z "$(check_port)" ]; then
      echo "Port $PORT is free."
      break
    fi
    sleep 0.25
    i=$((i + 1))
  done

  pids="$(check_port)"
  if [ -n "$pids" ]; then
    echo "Graceful shutdown timed out. Forcing kill on port $PORT..."
    for pid in $pids; do
      kill -KILL "$pid" 2>/dev/null || true
    done

    i=1
    while [ "$i" -le 20 ]; do
      if [ -z "$(check_port)" ]; then
        break
      fi
      sleep 0.25
      i=$((i + 1))
    done

    if [ -n "$(check_port)" ]; then
      echo "Port $PORT is still in use; not starting another server." >&2
      exit 1
    fi
  fi
fi

echo "Starting server on port $PORT..."
exec npm start
