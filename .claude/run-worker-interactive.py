#!/usr/bin/env python3
"""Interactive worker wrapper: streams colorized output while accepting user input."""

import subprocess
import sys
import json
import threading
import os
import signal

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
WHITE_ON_BLUE = "\033[97;44m"

exit_signal = None


def format_tool_input(name, inp):
    if name == "Bash":
        return inp.get("command", "")
    if name == "Read":
        return inp.get("file_path", "")
    if name in ("Write", "Edit"):
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


def output_reader(proc):
    """Read and format claude's stream-json output."""
    global exit_signal

    for line in proc.stdout:
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
                    print(f"{BOLD}{block['text']}{RESET}")
                elif block.get("type") == "tool_use":
                    name = block.get("name", "?")
                    inp = block.get("input", {})
                    desc = format_tool_input(name, inp)
                    print(f"  {CYAN}▶ {name}{RESET} {DIM}{truncate(desc)}{RESET}")

        elif t == "user":
            result = msg.get("tool_use_result", {})
            if isinstance(result, str):
                result = {"stdout": result}
            stdout = result.get("stdout", "")
            stderr = result.get("stderr", "")
            is_error = result.get("is_error", False)
            content = msg.get("message", {}).get("content", [])
            if content and isinstance(content[0], dict):
                is_error = is_error or content[0].get("is_error", False)

            if stderr and not stdout:
                print(f"  {RED}✗ {truncate(stderr)}{RESET}")
            elif is_error:
                print(f"  {RED}✗ {truncate(stdout or stderr)}{RESET}")
            elif stdout:
                print(f"  {GREEN}✓ {truncate(stdout)}{RESET}")

        elif t == "result":
            cost = msg.get("total_cost_usd", 0)
            dur = msg.get("duration_ms", 0) / 1000
            turns = msg.get("num_turns", 0)
            result_text = msg.get("result", "")
            last_line = result_text.strip().split("\n")[-1] if result_text else ""
            print(f"{DIM}── done: {turns} turns, {dur:.1f}s, ${cost:.4f} ──{RESET}")
            exit_signal = last_line

    sys.stdout.flush()


def input_sender(proc):
    """Read user input and forward as stream-json messages."""
    try:
        while proc.poll() is None:
            try:
                line = input(f"{WHITE_ON_BLUE} > {RESET} ")
            except EOFError:
                break
            if not line.strip():
                continue
            msg = json.dumps({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": line.strip()
                }
            })
            try:
                proc.stdin.write(msg + "\n")
                proc.stdin.flush()
            except BrokenPipeError:
                break
    except KeyboardInterrupt:
        pass


def run_worker():
    global exit_signal
    exit_signal = None

    cmd = [
        "claude", "--agent", "worker",
        "--print", "--verbose",
        "--input-format", "stream-json",
        "--output-format", "stream-json",
        "--permission-mode", "bypassPermissions",
    ]

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        bufsize=1,
    )

    # Send initial prompt
    init_msg = json.dumps({
        "type": "user",
        "message": {
            "role": "user",
            "content": "Check the GitHub project for assigned tasks and begin working."
        }
    })
    proc.stdin.write(init_msg + "\n")
    proc.stdin.flush()

    # Start output reader thread
    out_thread = threading.Thread(target=output_reader, args=(proc,), daemon=True)
    out_thread.start()

    # Run input sender on main thread (handles ctrl+c)
    input_sender(proc)

    proc.wait()
    out_thread.join(timeout=5)

    return exit_signal


def main():
    while True:
        print(f"\n{YELLOW}=== Worker starting ==={RESET}")
        signal_val = run_worker()
        print(f"{DIM}--- Exit signal: {signal_val} ---{RESET}")

        if signal_val == "EXIT:READY":
            print(f"{GREEN}More work available. Restarting immediately.{RESET}")
        elif signal_val == "EXIT:IDLE":
            print(f"{YELLOW}No work. Sleeping 300s...{RESET}")
            try:
                for i in range(300, 0, -1):
                    print(f"\r{DIM}Resuming in {i}s (ctrl+c to quit){RESET}", end="")
                    import time
                    time.sleep(1)
                print()
            except KeyboardInterrupt:
                print(f"\n{RED}Stopped.{RESET}")
                sys.exit(0)
        else:
            print(f"{RED}Unexpected exit. Sleeping 300s...{RESET}")
            try:
                import time
                time.sleep(300)
            except KeyboardInterrupt:
                print(f"\n{RED}Stopped.{RESET}")
                sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n{RED}Stopped.{RESET}")
        sys.exit(0)
