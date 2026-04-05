#!/usr/bin/env bash
# Runs the fntypescript worker agent in a loop.
# Immediately re-runs on EXIT:READY, waits 5 minutes on EXIT:IDLE.

set -euo pipefail

POLL_INTERVAL=300
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
FORMATTER="$SCRIPT_DIR/format-stream.py"

cd "$PROJECT_DIR"

while true; do
    echo "=== Worker starting at $(date) ==="

    TMPFILE=$(mktemp)
    claude --agent worker --print --verbose --output-format stream-json 2>&1 \
        | tee "$TMPFILE" \
        | python3 "$FORMATTER"

    # Parse exit signal from the raw JSON result
    LAST_RESULT=$(grep '"type":"result"' "$TMPFILE" | tail -1)
    EXIT_SIGNAL=$(echo "$LAST_RESULT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    text = d.get('result', '')
    last = text.strip().split('\n')[-1]
    print(last)
except: print('UNKNOWN')
" 2>/dev/null || echo "UNKNOWN")
    rm -f "$TMPFILE"

    echo "--- Exit signal: $EXIT_SIGNAL ---"

    if [[ "$EXIT_SIGNAL" == "EXIT:READY" ]]; then
        echo "More work available. Restarting immediately."
    elif [[ "$EXIT_SIGNAL" == "EXIT:IDLE" ]]; then
        echo "No work. Sleeping ${POLL_INTERVAL}s..."
        sleep "$POLL_INTERVAL"
    else
        echo "Unexpected exit. Sleeping ${POLL_INTERVAL}s..."
        sleep "$POLL_INTERVAL"
    fi
done
