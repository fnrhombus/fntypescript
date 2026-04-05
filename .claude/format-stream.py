#!/usr/bin/env python3
"""Formats Claude Code stream-json output into colorized human-readable text."""

import sys
import json

# ANSI colors
DIM = "\033[2m"
RESET = "\033[0m"
BOLD = "\033[1m"
CYAN = "\033[36m"
GREEN = "\033[32m"
YELLOW = "\033[33m"
RED = "\033[31m"
MAGENTA = "\033[35m"
BLUE = "\033[34m"

def format_tool_input(name, inp):
    if name == "Bash":
        return inp.get("command", "")
    if name == "Read":
        return inp.get("file_path", "")
    if name == "Write":
        return inp.get("file_path", "")
    if name == "Edit":
        return inp.get("file_path", "")
    if name in ("Grep", "Glob"):
        return inp.get("pattern", "")
    if name == "WebFetch":
        return inp.get("url", "")
    if name == "WebSearch":
        return inp.get("query", "")
    if name == "Agent":
        return inp.get("description", "")
    return json.dumps(inp)[:120]

def truncate(s, n=200):
    s = s.replace("\n", "\\n")
    return s[:n] + "…" if len(s) > n else s

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        msg = json.loads(line)
    except json.JSONDecodeError:
        print(line)
        continue

    t = msg.get("type", "")

    if t == "system" and msg.get("subtype") == "init":
        model = msg.get("model", "?")
        print(f"{DIM}── session: {msg.get('session_id', '?')[:8]}… model: {model} ──{RESET}")

    elif t == "assistant":
        content = msg.get("message", {}).get("content", [])
        for block in content:
            if block.get("type") == "text":
                text = block["text"]
                print(f"{BOLD}{text}{RESET}")
            elif block.get("type") == "tool_use":
                name = block.get("name", "?")
                inp = block.get("input", {})
                desc = format_tool_input(name, inp)
                print(f"  {CYAN}▶ {name}{RESET} {DIM}{truncate(desc)}{RESET}")

    elif t == "user":
        result = msg.get("tool_use_result", {})
        stdout = result.get("stdout", "")
        stderr = result.get("stderr", "")
        is_error = result.get("is_error", False) or msg.get("message", {}).get("content", [{}])[0].get("is_error", False)

        if stderr and not stdout:
            print(f"  {RED}✗ {truncate(stderr)}{RESET}")
        elif is_error:
            out = stdout or stderr
            print(f"  {RED}✗ {truncate(out)}{RESET}")
        elif stdout:
            print(f"  {GREEN}✓ {truncate(stdout)}{RESET}")

    elif t == "result":
        cost = msg.get("total_cost_usd", 0)
        dur = msg.get("duration_ms", 0) / 1000
        turns = msg.get("num_turns", 0)
        result_text = msg.get("result", "")
        # Extract last line for exit signal
        last_line = result_text.strip().split("\n")[-1] if result_text else ""
        print(f"{DIM}── done: {turns} turns, {dur:.1f}s, ${cost:.4f} ──{RESET}")
        # Print last line raw for the wrapper script to parse
        if last_line:
            print(last_line)
