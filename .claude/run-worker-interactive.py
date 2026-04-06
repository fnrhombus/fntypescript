#!/usr/bin/env python3
"""Interactive worker wrapper: streams colorized output while accepting user input.

Task claiming uses labels (quick visibility) + issue comments (distributed lock).
File lock prevents local races; comment protocol prevents cross-machine races.

Exit code:
  0 = work was done (loop should restart immediately)
  1 = no work available (loop should sleep before retrying)
"""

import subprocess
import sys
import json
import threading
import os
import signal
import fcntl
import time
import random
import argparse

# Human-readable worker names
WORKER_NAMES = [
    "alice", "bob", "carol", "dave", "eve", "frank", "grace", "heidi",
    "ivan", "judy", "karl", "luna", "mike", "nora", "oscar", "penny",
]

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

LOCK_FILE = "/tmp/fntypescript-worker.lock"
REPO = "fnrhombus/fntypescript"
IDLE_SLEEP = 180  # seconds to sleep when no work available

# Generate a persistent worker ID for this process lifetime
WORKER_ID = f"{random.choice(WORKER_NAMES)}-{random.randint(10000, 99999)}"

VERBOSE = False


def gh_comment(issue_num, body):
    """Post a comment on an issue."""
    subprocess.run(
        ["gh", "issue", "comment", str(issue_num), "--body", body, "--repo", REPO],
        capture_output=True, text=True, timeout=30
    )


def check_claim_won(issue_num):
    """Check if our CLAIM is the most recent one (no competing claim posted after ours).

    Returns True if we won the claim, False if someone else claimed after us.
    """
    result = subprocess.run(
        ["gh", "issue", "view", str(issue_num), "--repo", REPO,
         "--json", "comments", "--jq",
         '.comments | map(select(.body | startswith("CLAIM "))) | .[-3:] | .[] | .body'],
        capture_output=True, text=True, timeout=30
    )

    if result.returncode != 0:
        return False

    lines = [l.strip() for l in result.stdout.strip().split("\n") if l.strip()]

    # Simple rule: the LAST claim wins.
    if not lines:
        return False

    return lines[-1] == f"CLAIM {WORKER_ID}"


def claim_task():
    """Scan for tasks, claim one using labels + comment protocol.

    Returns (issue_number, agent_label) or (None, None) if no work available.
    """
    lock_fd = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)

        # Scan for tasks with agent: labels
        result = subprocess.run(
            ["gh", "issue", "list", "--repo", REPO, "--state", "open",
             "--json", "number,title,labels", "--jq",
             '.[] | select(.labels | map(.name) | any(startswith("agent:"))) | '
             '{number, title, agent: (.labels | map(.name) | map(select(startswith("agent:"))) | .[0]), '
             'priority: (.labels | map(.name) | map(select(startswith("P"))) | .[0] // "P9")}'],
            capture_output=True, text=True, timeout=30
        )

        if result.returncode != 0 or not result.stdout.strip():
            return None, None

        # Parse tasks and sort by priority
        tasks = []
        for line in result.stdout.strip().split("\n"):
            try:
                task = json.loads(line)
                if task.get("agent") == "agent:fnrhombus":
                    continue
                tasks.append(task)
            except json.JSONDecodeError:
                continue

        if not tasks:
            return None, None

        tasks.sort(key=lambda t: t.get("priority", "P9"))

        # Try to claim each task in priority order
        for chosen in tasks:
            agent_label = chosen["agent"]
            issue_num = chosen["number"]

            # Post claim comment
            gh_comment(issue_num, f"CLAIM {WORKER_ID}")

            # Wait for any concurrent claims to land
            time.sleep(3)

            # Verify we won
            if not check_claim_won(issue_num):
                print(f"{YELLOW}Lost claim on #{issue_num} to another worker, trying next...{RESET}")
                continue

            # We won — remove the label
            subprocess.run(
                ["gh", "issue", "edit", str(issue_num), "--remove-label", agent_label,
                 "--repo", REPO],
                capture_output=True, text=True, timeout=30
            )

            print(f"{GREEN}[{WORKER_ID}] Claimed #{issue_num}: {chosen.get('title', '?')} ({agent_label}){RESET}")
            return issue_num, agent_label

        return None, None

    except Exception as e:
        print(f"{RED}Error claiming task: {e}{RESET}")
        return None, None
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()


def release_task(issue_num, reason="done"):
    """Post a RELEASE comment on an issue."""
    gh_comment(issue_num, f"RELEASE {WORKER_ID} — {reason}")


def cleanup_worktrees():
    """Remove stale worktrees and their branches."""
    result = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        return

    main_worktree = None
    stale = []
    current = {}
    for line in result.stdout.split("\n"):
        if line.startswith("worktree "):
            current = {"path": line.split(" ", 1)[1]}
        elif line.startswith("branch "):
            current["branch"] = line.split(" ", 1)[1].replace("refs/heads/", "")
        elif line == "":
            if current.get("path"):
                if main_worktree is None:
                    main_worktree = current["path"]
                else:
                    stale.append(current)
            current = {}

    for wt in stale:
        path = wt["path"]
        branch = wt.get("branch", "")
        if VERBOSE:
            print(f"{DIM}Cleaning worktree: {path} ({branch}){RESET}")
        subprocess.run(["git", "worktree", "remove", "--force", path],
                       capture_output=True, text=True, timeout=30)
        if branch and branch != "main":
            subprocess.run(["git", "branch", "-D", branch],
                           capture_output=True, text=True, timeout=30)

    # Also clean up local branches that look like stale agent/feature branches
    result = subprocess.run(
        ["git", "branch", "--format", "%(refname:short)"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode == 0:
        for branch in result.stdout.strip().split("\n"):
            branch = branch.strip()
            if not branch or branch == "main":
                continue
            if branch.startswith(("worktree-agent-", "feat/")):
                subprocess.run(["git", "branch", "-D", branch],
                               capture_output=True, text=True, timeout=30)
                if VERBOSE:
                    print(f"{DIM}Deleted branch: {branch}{RESET}")

    # Prune remote tracking branches
    subprocess.run(["git", "remote", "prune", "origin"],
                   capture_output=True, text=True, timeout=30)


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
    s = s.replace("\\n", " ").replace("\\t", " ").replace("\n", " ").replace("\t", " ")
    s = " ".join(s.split())  # collapse multiple spaces
    return s[:n] + "…" if len(s) > n else s


def output_reader(proc, done_event):
    """Read and format claude's stream-json output. Sets done_event when result is received."""
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            if VERBOSE:
                print(line)
            continue

        t = msg.get("type", "")

        if t == "system" and msg.get("subtype") == "init":
            if VERBOSE:
                model = msg.get("model", "?")
                print(f"{DIM}── session: {msg.get('session_id', '?')[:8]}… model: {model} ──{RESET}")

        elif t == "assistant":
            if VERBOSE:
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
            if VERBOSE:
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
            print(f"{DIM}── done: {turns} turns, {dur:.1f}s, ${cost:.4f} ──{RESET}")
            done_event.set()  # Signal that work is complete

    sys.stdout.flush()


def input_sender(proc, done_event):
    """Read user input and forward as stream-json messages. Exits when done_event is set."""
    import select
    try:
        while proc.poll() is None and not done_event.is_set():
            # Poll stdin with timeout so we can check done_event periodically
            ready, _, _ = select.select([sys.stdin], [], [], 1.0)
            if not ready:
                continue
            try:
                line = sys.stdin.readline()
            except EOFError:
                break
            if not line:  # EOF
                break
            line = line.strip()
            if not line:
                continue
            msg = json.dumps({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": line
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
    """Run one worker cycle. Returns True if work was done, False if no work available."""

    # Claim a task atomically before launching claude
    issue_num, agent_label = claim_task()
    if issue_num is None:
        if VERBOSE:
            print(f"{DIM}No tasks available.{RESET}")
        return False

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

    # Tell the worker which task was already claimed
    init_msg = json.dumps({
        "type": "user",
        "message": {
            "role": "user",
            "content": (
                f"Task already claimed for you: issue #{issue_num} (was {agent_label}). "
                f"The {agent_label} label has already been removed. "
                f"Worker ID: {WORKER_ID}. "
                f"Skip the startup scan and claiming steps — go straight to execution. "
                f"Read the issue spec and begin work."
            )
        }
    })
    proc.stdin.write(init_msg + "\n")
    proc.stdin.flush()

    # done_event signals when the result message arrives (work is complete)
    done_event = threading.Event()

    # Start output reader thread
    out_thread = threading.Thread(target=output_reader, args=(proc, done_event), daemon=True)
    out_thread.start()

    # Run input sender on main thread (handles ctrl+c, exits when done)
    input_sender(proc, done_event)

    # Wait for the result message (up to 10 minutes beyond stdin EOF)
    done_event.wait(timeout=600)

    # Kill the claude process if it's still running (don't wait for natural exit)
    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    out_thread.join(timeout=5)

    # Release the task
    release_task(issue_num, "worker session ended")

    return True  # Work was done


def main():
    global VERBOSE
    parser = argparse.ArgumentParser(description="fntypescript worker")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Show full claude output (tool calls, results, assistant text)")
    args = parser.parse_args()
    VERBOSE = args.verbose

    print(f"{BOLD}Worker {WORKER_ID} starting{RESET}")
    cleanup_worktrees()

    while True:
        if VERBOSE:
            print(f"\n{YELLOW}=== Worker cycle ==={RESET}")
        work_done = run_worker()

        if work_done:
            print(f"{GREEN}[{WORKER_ID}] Work done. Restarting immediately.{RESET}")
        else:
            print(f"{YELLOW}[{WORKER_ID}] No work. Sleeping {IDLE_SLEEP}s...{RESET}")
            try:
                if VERBOSE:
                    for i in range(IDLE_SLEEP, 0, -1):
                        print(f"\r{DIM}Resuming in {i}s (ctrl+c to quit){RESET}", end="")
                        time.sleep(1)
                    print()
                else:
                    time.sleep(IDLE_SLEEP)
            except KeyboardInterrupt:
                print(f"\n{RED}Stopped.{RESET}")
                sys.exit(0)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print(f"\n{RED}Stopped.{RESET}")
        sys.exit(0)
