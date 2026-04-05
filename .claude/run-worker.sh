#!/usr/bin/env bash
# Runs the fntypescript worker agent in a loop.
# Immediately re-runs on EXIT:READY, waits 5 minutes on EXIT:IDLE.

set -euo pipefail

POLL_INTERVAL=300
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

cd "$PROJECT_DIR"

while true; do
    echo "=== Worker starting at $(date) ==="

    OUTPUT=$(claude --agent worker --print 2>&1) || true
    LAST_LINE=$(echo "$OUTPUT" | tail -1)

    echo "$OUTPUT"
    echo "--- Exit signal: $LAST_LINE ---"

    if [[ "$LAST_LINE" == "EXIT:READY" ]]; then
        echo "More work available. Restarting immediately."
    elif [[ "$LAST_LINE" == "EXIT:IDLE" ]]; then
        echo "No work. Sleeping ${POLL_INTERVAL}s..."
        sleep "$POLL_INTERVAL"
    else
        echo "Unexpected exit. Sleeping ${POLL_INTERVAL}s..."
        sleep "$POLL_INTERVAL"
    fi
done
