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
import re
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
WORKTREE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worktrees")
PLANNER_LOCK_FILE = "/tmp/fntypescript-planner.lock"
PLANNER_COOLDOWN_FILE = "/tmp/fntypescript-planner-cooldown"
PLANNER_COOLDOWN = 900  # 15 minutes between planner runs that find no work
REPO = "fnrhombus/fntypescript"
IDLE_SLEEP = 180  # seconds to sleep when no work available

# Generate a persistent worker ID for this process lifetime
WORKER_ID = f"{random.choice(WORKER_NAMES)}-{random.randint(10000, 99999)}"

VERBOSE = False
INTERACTIVE = True
STOP_REQUESTED = False


def ts():
    """Short timestamp for log lines."""
    return time.strftime("%H:%M:%S")


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
         '.comments | map(select(.body | startswith("CLAIM ") or startswith("RELEASE "))) | .[-5:] | .[] | .body'],
        capture_output=True, text=True, timeout=30
    )

    if result.returncode != 0:
        return False

    lines = [l.strip() for l in result.stdout.strip().split("\n") if l.strip()]

    if not lines:
        return False

    # Our CLAIM must be the first one after the last RELEASE (or the first ever).
    # If someone else claimed after us, or there's a RELEASE after us, we lost.
    last_release_idx = -1
    for i, line in enumerate(lines):
        if line.startswith("RELEASE "):
            last_release_idx = i

    # Find the first CLAIM after the last RELEASE
    for line in lines[last_release_idx + 1:]:
        if line.startswith("CLAIM "):
            return line == f"CLAIM {WORKER_ID}"

    return False


def is_blocked(issue_num):
    """Check if an issue references other issues that are still open."""
    result = subprocess.run(
        ["gh", "issue", "view", str(issue_num), "--repo", REPO,
         "--json", "body", "--jq", ".body"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0 or not result.stdout.strip():
        return False

    # Find all issue references (#N) in the body
    refs = set(int(m) for m in re.findall(r"#(\d+)", result.stdout))
    if not refs:
        return False

    # Check which referenced issues are still open
    for ref in refs:
        check = subprocess.run(
            ["gh", "issue", "view", str(ref), "--repo", REPO,
             "--json", "state", "--jq", ".state"],
            capture_output=True, text=True, timeout=30
        )
        if check.returncode == 0 and check.stdout.strip() == "OPEN":
            print(f"{YELLOW}{ts()} [{WORKER_ID}] #{issue_num} blocked on #{ref} (still open){RESET}")
            return True

    return False


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

            # Check for blocking dependencies before claiming
            if is_blocked(issue_num):
                if VERBOSE:
                    print(f"{DIM}{ts()} [{WORKER_ID}] #{issue_num} is blocked, skipping...{RESET}")
                continue

            # Post claim comment
            gh_comment(issue_num, f"CLAIM {WORKER_ID}")

            # Wait for any concurrent claims to land
            time.sleep(3)

            # Verify we won
            if not check_claim_won(issue_num):
                print(f"{YELLOW}{ts()} [{WORKER_ID}] Lost claim on #{issue_num} to another worker, trying next...{RESET}")
                continue

            # Verify the label is still present (guards against stale list results)
            label_check = subprocess.run(
                ["gh", "issue", "view", str(issue_num), "--repo", REPO,
                 "--json", "labels", "--jq",
                 '.labels | map(.name) | any(. == "' + agent_label + '")'],
                capture_output=True, text=True, timeout=30
            )
            if label_check.stdout.strip() != "true":
                print(f"{YELLOW}{ts()} [{WORKER_ID}] #{issue_num} label already removed, skipping...{RESET}")
                continue

            # We won — remove the label
            subprocess.run(
                ["gh", "issue", "edit", str(issue_num), "--remove-label", agent_label,
                 "--repo", REPO],
                capture_output=True, text=True, timeout=30
            )

            print(f"{GREEN}{ts()} [{WORKER_ID}] Claimed #{issue_num}: {chosen.get('title', '?')} ({agent_label}){RESET}")
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
            if branch.startswith(("worktree-agent-", "feat/")) or "/issue-" in branch:
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
            content = msg.get("message", {}).get("content", [])
            for block in content:
                if block.get("type") == "text":
                    if VERBOSE:
                        print(f"{BOLD}{block['text']}{RESET}")
                    else:
                        # In quiet mode, print first line of each paragraph as a status update
                        for para in block["text"].strip().split("\n"):
                            para = para.strip()
                            if para:
                                print(f"{DIM}{ts()} [{WORKER_ID}] {para}{RESET}")
                                break
                elif block.get("type") == "tool_use" and VERBOSE:
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
            print(f"{DIM}{ts()} ── done: {turns} turns, {dur:.1f}s, ${cost:.4f} ──{RESET}")
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


def run_planner():
    """Run the planner when no tasks are available. Uses a lock so only one worker does this.
    Returns True if the planner ran (work may now be available), False if skipped."""
    # Check cooldown: don't re-run the planner if it recently found nothing
    if os.path.exists(PLANNER_COOLDOWN_FILE):
        age = time.time() - os.path.getmtime(PLANNER_COOLDOWN_FILE)
        if age < PLANNER_COOLDOWN:
            if VERBOSE:
                print(f"{DIM}{ts()} [{WORKER_ID}] Planner on cooldown ({int(PLANNER_COOLDOWN - age)}s remaining)...{RESET}")
            return False

    lock_fd = open(PLANNER_LOCK_FILE, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (BlockingIOError, OSError):
        # Another worker is already running the planner
        if VERBOSE:
            print(f"{DIM}{ts()} [{WORKER_ID}] Another worker is running the planner, skipping...{RESET}")
        lock_fd.close()
        return False

    try:
        print(f"{MAGENTA}{ts()} [{WORKER_ID}] No tasks available — running planner...{RESET}")

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

        init_msg = json.dumps({
            "type": "user",
            "message": {
                "role": "user",
                "content": (
                    f"No tasks have agent: labels. Worker ID: {WORKER_ID}. "
                    f"Run the triage agent to do a big-picture review. "
                    f"Check milestones, assess gaps, create tasks if needed."
                )
            }
        })
        proc.stdin.write(init_msg + "\n")
        proc.stdin.flush()
        proc.stdin.close()

        done_event = threading.Event()
        out_thread = threading.Thread(target=output_reader, args=(proc, done_event), daemon=True)
        out_thread.start()

        done_event.wait(timeout=600)

        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

        out_thread.join(timeout=5)

        # Check if the planner actually created new tasks
        check = subprocess.run(
            ["gh", "issue", "list", "--repo", REPO, "--state", "open",
             "--json", "labels", "--jq",
             '[.[] | select(.labels | map(.name) | any(startswith("agent:")))] | length'],
            capture_output=True, text=True, timeout=30
        )
        new_tasks = int(check.stdout.strip() or "0") if check.returncode == 0 else 0
        if new_tasks > 0:
            print(f"{GREEN}{ts()} [{WORKER_ID}] Planner created {new_tasks} task(s).{RESET}")
            # Clear cooldown so workers pick up immediately
            if os.path.exists(PLANNER_COOLDOWN_FILE):
                os.remove(PLANNER_COOLDOWN_FILE)
            return True
        else:
            print(f"{DIM}{ts()} [{WORKER_ID}] Planner ran but no new tasks. Cooldown {PLANNER_COOLDOWN}s.{RESET}")
            # Set cooldown
            open(PLANNER_COOLDOWN_FILE, "w").close()
            return False
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()


def handle_sigint(signum, frame):
    """First ctrl+c: request graceful stop. Second: hard exit."""
    global STOP_REQUESTED
    if STOP_REQUESTED:
        print(f"\n{RED}[{WORKER_ID}] Force killed.{RESET}")
        sys.exit(1)
    STOP_REQUESTED = True
    print(f"\n{YELLOW}{ts()} [{WORKER_ID}] Graceful stop requested — finishing current task, then exiting. (ctrl+c again to force kill){RESET}")


def run_worker():
    """Run one worker cycle. Returns True if work was done, False if no work available."""

    # Claim a task atomically before launching claude
    issue_num, agent_label = claim_task()
    if issue_num is None:
        return run_planner()

    # Create a named worktree for code agents to work in
    worktree_branch = f"{WORKER_ID}/issue-{issue_num}"
    worktree_path = os.path.join(WORKTREE_DIR, f"{WORKER_ID}-issue-{issue_num}")
    worktree_created = False

    if agent_label in ("agent:fn10x", "agent:fnnitpick"):
        os.makedirs(WORKTREE_DIR, exist_ok=True)
        wt_result = subprocess.run(
            ["git", "worktree", "add", worktree_path, "-b", worktree_branch],
            capture_output=True, text=True, timeout=30
        )
        if wt_result.returncode == 0:
            worktree_created = True
            if VERBOSE:
                print(f"{DIM}{ts()} [{WORKER_ID}] Created worktree: {worktree_path} ({worktree_branch}){RESET}")
        else:
            print(f"{YELLOW}{ts()} [{WORKER_ID}] Worktree creation failed, agent will work in main: {wt_result.stderr.strip()}{RESET}")

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
    worktree_info = ""
    if worktree_created:
        worktree_info = (
            f"A git worktree has been created for this task at: {worktree_path} "
            f"(branch: {worktree_branch}). "
            f"Tell the code/QA agent to work in this directory. "
            f"Do NOT use isolation: \"worktree\" — the worktree is already set up. "
        )

    init_msg = json.dumps({
        "type": "user",
        "message": {
            "role": "user",
            "content": (
                f"Task already claimed for you: issue #{issue_num} (was {agent_label}). "
                f"The {agent_label} label has already been removed. "
                f"Worker ID: {WORKER_ID}. "
                f"{worktree_info}"
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

    if INTERACTIVE:
        # Run input sender on main thread (handles ctrl+c, exits when done)
        input_sender(proc, done_event)
    else:
        # Non-interactive: close stdin and just wait
        proc.stdin.close()

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
    if STOP_REQUESTED:
        # Re-add the agent label so another worker can pick it up
        subprocess.run(
            ["gh", "issue", "edit", str(issue_num), "--add-label", agent_label,
             "--repo", REPO],
            capture_output=True, text=True, timeout=30
        )
        release_task(issue_num, f"graceful stop requested — re-added {agent_label}")
        print(f"{YELLOW}{ts()} [{WORKER_ID}] #{issue_num} released back to the pool ({agent_label}){RESET}")
    else:
        release_task(issue_num, "worker session ended")

    return True  # Work was done


def main():
    global VERBOSE, INTERACTIVE
    parser = argparse.ArgumentParser(description="fntypescript worker")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Show full claude output (tool calls, results, assistant text)")
    parser.add_argument("-n", "--iterations", type=int, default=0, metavar="N",
                        help="Number of iterations to run (0 = infinite, default: 0)")
    parser.add_argument("--no-interactive", action="store_true",
                        help="Non-interactive mode: no stdin forwarding, just run and exit")
    args = parser.parse_args()
    VERBOSE = args.verbose
    INTERACTIVE = not args.no_interactive
    max_iters = args.iterations

    signal.signal(signal.SIGINT, handle_sigint)

    print(f"{BOLD}{ts()} Worker {WORKER_ID} starting{' (' + str(max_iters) + ' iterations)' if max_iters else ''}{RESET}")
    cleanup_worktrees()

    iteration = 0
    while max_iters == 0 or iteration < max_iters:
        if STOP_REQUESTED:
            print(f"{YELLOW}{ts()} [{WORKER_ID}] Stop requested, not picking up new work.{RESET}")
            break

        iteration += 1
        if VERBOSE:
            print(f"\n{YELLOW}=== Worker cycle {iteration}{('/' + str(max_iters)) if max_iters else ''} ==={RESET}")
        work_done = run_worker()

        if STOP_REQUESTED:
            break

        if work_done:
            print(f"{GREEN}{ts()} [{WORKER_ID}] Work done. Restarting immediately.{RESET}")
        else:
            if max_iters and iteration >= max_iters:
                break
            print(f"{YELLOW}{ts()} [{WORKER_ID}] No work. Sleeping {IDLE_SLEEP}s...{RESET}")
            for i in range(IDLE_SLEEP):
                if STOP_REQUESTED:
                    break
                if VERBOSE:
                    print(f"\r{DIM}Resuming in {IDLE_SLEEP - i}s (ctrl+c to quit){RESET}", end="")
                time.sleep(1)
            if VERBOSE:
                print()

    print(f"{DIM}{ts()} [{WORKER_ID}] Done ({iteration} iterations).{RESET}")


if __name__ == "__main__":
    main()
