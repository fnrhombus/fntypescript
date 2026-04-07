#!/usr/bin/env python3
"""Worker loop: dispatches fn10x, fnnitpick, and triage agents based on priority.

Priority order each cycle:
  0. Merge approved PRs (auto-merge)
  1. PRs needing review (fnnitpick)
  2. Rejected PRs needing fixes (fn10x)
  3. Tasks in 'Ready for Dev' board column (fn10x, new work)
  4. Nothing available → triage (create tasks or confirm done)

Routing uses project board columns (Ready for Dev, Ready for QA, etc.).
Claiming uses CLAIM/RELEASE/HEARTBEAT issue comments (distributed lock).
Board 'Claimed By' field provides visibility of who holds each item.
File lock prevents local races; comment protocol prevents cross-machine races.
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
import colorsys
from datetime import datetime, timezone

# Human-readable worker names (top 100 US names, SSA + Census data)
WORKER_NAMES = [
    "aaron", "abigail", "adam", "alan", "albert", "alexander", "alexis", "alice", "amanda", "amber",
    "andrea", "andrew", "angela", "anna", "anthony", "arthur", "ashley", "austin", "barbara", "benjamin",
    "betty", "beverly", "brandon", "brenda", "brian", "brittany", "bruce", "carol", "carolyn", "catherine",
    "charles", "charlotte", "cheryl", "christian", "christina", "christine", "christopher", "cynthia", "daniel", "danielle",
    "david", "deborah", "denise", "dennis", "diana", "diane", "donald", "donna", "dorothy", "douglas",
    "dylan", "edward", "elijah", "elizabeth", "emily", "emma", "eric", "ethan", "evelyn", "frances",
    "frank", "gabriel", "gary", "george", "gerald", "grace", "gregory", "hannah", "harold", "heather",
    "helen", "henry", "isabella", "jacob", "jacqueline", "james", "janet", "janice", "jason", "jean",
    "jeffrey", "jennifer", "jeremy", "jessica", "joan", "john", "jonathan", "jordan", "joseph", "joshua",
    "joyce", "juan", "judith", "julia", "julie", "justin", "karen", "katherine", "keith", "kelly",
]

RESET = "\033[0m"


def _hsl(h, s, l):
    """HSL to 24-bit ANSI. h: 0-360, s/l: 0-100."""
    r, g, b = colorsys.hls_to_rgb(h / 360, l / 100, s / 100)
    return f"\033[38;2;{int(r * 255)};{int(g * 255)};{int(b * 255)}m"


class WorkerColors:
    """Per-worker color palette. Hue is locked; saturation/lightness vary by message type."""

    def __init__(self, color_index):
        # Golden angle on sequential index → max hue separation between concurrent workers
        self.hue = (color_index * 137.508) % 360

    def _c(self, s, l):
        return _hsl(self.hue, s, l)

    @property
    def success(self):    return self._c(80, 72)   # vivid, bright — claimed, work done

    @property
    def warning(self):    return self._c(55, 62)   # desaturated, mid — lost claim, blocked

    @property
    def error(self):      return self._c(90, 58)   # intense, slightly darker — failures

    @property
    def info(self):       return self._c(20, 55)   # very muted but hue visible — default

    @property
    def emphasis(self):   return self._c(70, 78)   # vivid, light — starting, headings

    @property
    def tool(self):       return self._c(45, 67)   # moderate — tool calls

    @property
    def tool_ok(self):    return self._c(50, 70)   # tool success ✓

    @property
    def dim(self):        return self._c(12, 50)   # barely tinted — session info, done line

    @property
    def triage(self):     return self._c(65, 68)   # distinct from success — triage activity


class SupervisorColors:
    """White-only palette for orchestration output."""
    success   = "\033[97m"
    warning   = "\033[97m"
    error     = "\033[91m"
    info      = "\033[37m"
    emphasis  = "\033[1;97m"
    tool      = "\033[37m"
    tool_ok   = "\033[37m"
    dim       = "\033[2;37m"
    triage    = "\033[37m"

CONTEXT_CACHE_FILE = "/tmp/fntypescript-codebase-context.cache"
LOCK_FILE = "/tmp/fntypescript-worker.lock"
WORKTREE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worktrees")
TRIAGE_LOCK_FILE = "/tmp/fntypescript-triage.lock"
TRIAGE_COOLDOWN_FILE = "/tmp/fntypescript-triage-cooldown"
TRIAGE_COOLDOWN = 900  # 15 minutes between triage runs that find no work
REPO = "fnrhombus/fntypescript"

_worker_num = random.randint(10000, 99999)
WORKER_ID = f"{WORKER_NAMES[_worker_num % len(WORKER_NAMES)]}-{_worker_num}"
C = WorkerColors(0)

VERBOSE = False
STOP_REQUESTED = False
QUIET = False  # suppress output from workers that find no work

def ts():
    return time.strftime("%H:%M:%S")


def log(msg, color=None, quiet_ok=False):
    if QUIET and quiet_ok:
        return
    if color is None:
        color = C.info
    print(f"{color}{ts()} [{WORKER_ID}] {msg}{RESET}")


# ── GitHub helpers ──────────────────────────────────────────────────

def gh_comment(issue_num, body):
    subprocess.run(
        ["gh", "issue", "comment", str(issue_num), "--body", body, "--repo", REPO],
        capture_output=True, text=True, timeout=30
    )


# ── Board management ───────────────────────────────────────────────

PROJECT_ID = "PVT_kwHOACZSnM4BTvD0"
STATUS_FIELD_ID = "PVTSSF_lAHOACZSnM4BTvD0zhA7-Rg"
CLAIMED_BY_FIELD_ID = "PVTF_lAHOACZSnM4BTvD0zhBFwmQ"

BOARD_STATUS = {
    "backlog": "a233181e", "ready_for_dev": "22da6746",
    "dev_in_progress": "790d1811", "ready_for_qa": "53d6c465",
    "qa_in_progress": "c387ab6b", "awaiting_merge": "a2e44fab",
    "done": "d964e466",
}

BOARD_QUERY = '''{
  node(id: "%s") {
    ... on ProjectV2 {
      items(first: 100) {
        nodes {
          id
          status: fieldValueByName(name: "Status") {
            ... on ProjectV2ItemFieldSingleSelectValue { optionId }
          }
          claimedBy: fieldValueByName(name: "Claimed By") {
            ... on ProjectV2ItemFieldTextValue { text }
          }
          content {
            ... on Issue { number title state }
          }
        }
      }
    }
  }
}''' % PROJECT_ID


def query_board_items(status):
    """Get open issues in a board column. Returns [{number, title, item_id, claimed_by}]."""
    target_id = BOARD_STATUS.get(status)
    if not target_id:
        return []
    result = subprocess.run(
        ["gh", "api", "graphql", "-f", f"query={BOARD_QUERY}"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        return []
    data = json.loads(result.stdout)
    items = data.get("data", {}).get("node", {}).get("items", {}).get("nodes", [])
    matches = []
    for item in items:
        content = item.get("content")
        if not content or content.get("state") != "OPEN":
            continue
        status_val = item.get("status")
        if not status_val or status_val.get("optionId") != target_id:
            continue
        claimed = item.get("claimedBy")
        matches.append({
            "number": content["number"],
            "title": content.get("title", ""),
            "item_id": item["id"],
            "claimed_by": claimed.get("text", "") if claimed else "",
        })
    return matches


_item_id_cache = {}
_item_id_cache_time = 0


def get_project_item_id(issue_num):
    """Get the project board item ID for an issue number. Cached for 60s."""
    global _item_id_cache, _item_id_cache_time
    now = time.time()
    if issue_num in _item_id_cache and now - _item_id_cache_time < 60:
        return _item_id_cache[issue_num]
    result = subprocess.run(
        ["gh", "project", "item-list", "4", "--owner", "fnrhombus",
         "--format", "json"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        return None
    try:
        data = json.loads(result.stdout)
    except json.JSONDecodeError:
        return None
    _item_id_cache = {}
    _item_id_cache_time = now
    for item in data.get("items", []):
        num = item.get("content", {}).get("number")
        if num:
            _item_id_cache[num] = item["id"]
    return _item_id_cache.get(issue_num)


def update_board_status(issue_num, status, item_id=None):
    """Move an issue to a board column."""
    option_id = BOARD_STATUS.get(status)
    if not option_id:
        return
    if not item_id:
        item_id = get_project_item_id(issue_num)
    if not item_id:
        return
    subprocess.run(
        ["gh", "project", "item-edit",
         "--project-id", PROJECT_ID,
         "--id", item_id,
         "--field-id", STATUS_FIELD_ID,
         "--single-select-option-id", option_id],
        capture_output=True, text=True, timeout=30
    )


def set_claimed_by(issue_num, worker_id, item_id=None):
    """Set the 'Claimed By' field on a board item."""
    if not item_id:
        item_id = get_project_item_id(issue_num)
    if not item_id:
        return
    subprocess.run(
        ["gh", "project", "item-edit",
         "--project-id", PROJECT_ID,
         "--id", item_id,
         "--field-id", CLAIMED_BY_FIELD_ID,
         "--text", worker_id],
        capture_output=True, text=True, timeout=30
    )


def clear_claimed_by(issue_num, item_id=None):
    """Clear the 'Claimed By' field on a board item."""
    if not item_id:
        item_id = get_project_item_id(issue_num)
    if not item_id:
        return
    subprocess.run(
        ["gh", "api", "graphql", "-f", f'query=mutation {{ clearProjectV2ItemFieldValue(input: {{projectId: "{PROJECT_ID}", itemId: "{item_id}", fieldId: "{CLAIMED_BY_FIELD_ID}"}}) {{ projectV2Item {{ id }} }} }}'],
        capture_output=True, text=True, timeout=30
    )


def ensure_on_board(issue_num, status=None):
    """Ensure an issue is on the board, adding it if needed. Returns item_id."""
    item_id = get_project_item_id(issue_num)
    if not item_id:
        result = subprocess.run(
            ["gh", "project", "item-add", "4", "--owner", "fnrhombus",
             "--url", f"https://github.com/{REPO}/issues/{issue_num}",
             "--format", "json"],
            capture_output=True, text=True, timeout=30
        )
        if result.returncode == 0:
            try:
                item_id = json.loads(result.stdout).get("id")
            except json.JSONDecodeError:
                pass
    if item_id and status:
        update_board_status(issue_num, status, item_id=item_id)
    return item_id


def get_linked_issue(pr_num):
    """Get the first issue number referenced in a PR body."""
    result = subprocess.run(
        ["gh", "pr", "view", str(pr_num), "--repo", REPO,
         "--json", "body", "--jq", ".body"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode == 0:
        refs = re.findall(r"#(\d+)", result.stdout)
        if refs:
            return int(refs[0])
    return None


# ── Codebase context cache ─────────────────────────────────────────

def get_codebase_context():
    """Return a cached codebase snapshot. Regenerates when HEAD changes."""
    head = subprocess.run(
        ["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=10
    ).stdout.strip()

    # Check cache
    if os.path.exists(CONTEXT_CACHE_FILE):
        with open(CONTEXT_CACHE_FILE) as f:
            lines = f.readlines()
            if lines and lines[0].strip() == head:
                return "".join(lines[1:])

    # Generate: file tree + key file contents
    tree = subprocess.run(
        ["git", "ls-files", "--", "packages/", "examples/"],
        capture_output=True, text=True, timeout=10
    ).stdout.strip()

    # Read key source files (small, high-signal)
    key_files = [
        "packages/fntypescript/src/index.ts",
        "packages/fntypescript/src/types.ts",
        "packages/fntypescript/src/proxy.ts",
        "packages/fntypescript/src/define-plugin.ts",
        "packages/fntypescript/src/loader.ts",
        "packages/fntypescript/package.json",
    ]
    file_contents = []
    for path in key_files:
        if os.path.exists(path):
            with open(path) as f:
                content = f.read()
            file_contents.append(f"### {path}\n```ts\n{content}\n```")

    context = (
        f"## Project file tree\n```\n{tree}\n```\n\n"
        f"## Key source files\n\n" + "\n\n".join(file_contents)
    )

    # Cache it
    with open(CONTEXT_CACHE_FILE, "w") as f:
        f.write(head + "\n")
        f.write(context)

    return context


# ── Priority 0: Merge approved PRs ─────────────────────────────────

def find_mergeable_pr():
    """Find an open PR where fnnitpick approved and auto-merge is not already enabled."""
    result = subprocess.run(
        ["gh", "pr", "list", "--repo", REPO, "--state", "open",
         "--json", "number,title,reviews,autoMergeRequest"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0 or not result.stdout.strip():
        return None

    prs = json.loads(result.stdout)
    for pr in prs:
        # Skip if auto-merge already enabled
        if pr.get("autoMergeRequest"):
            continue

        reviews = pr.get("reviews", [])
        qa_reviews = [r for r in reviews
                      if r.get("author", {}).get("login") == "fnnitpick"]
        if not qa_reviews:
            continue
        latest = qa_reviews[-1]
        if latest.get("state") != "APPROVED":
            continue

        return {"number": pr["number"], "title": pr["title"]}

    return None


def merge_pr(pr):
    """Merge an approved PR. Uses --auto to queue merge when checks pass."""
    pr_num = pr["number"]
    log(f"Merging PR #{pr_num}: {pr['title']}", C.success)
    result = subprocess.run(
        ["gh", "pr", "merge", str(pr_num), "--repo", REPO,
         "--squash", "--delete-branch", "--auto"],
        capture_output=True, text=True, timeout=60
    )
    if result.returncode == 0:
        log(f"PR #{pr_num} auto-merge enabled", C.success)
        issue_num = get_linked_issue(pr_num)
        if issue_num:
            update_board_status(issue_num, "awaiting_merge")
    else:
        log(f"Failed to merge PR #{pr_num}: {result.stderr.strip()}", C.error)
    return True



# ── Priority 1: PRs needing review ─────────────────────────────────

def find_pr_needing_review():
    """Find and claim an open PR where CI passed and fnnitpick hasn't reviewed."""
    result = subprocess.run(
        ["gh", "pr", "list", "--repo", REPO, "--state", "open",
         "--json", "number,title,reviews,statusCheckRollup"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0 or not result.stdout.strip():
        return None

    prs = json.loads(result.stdout)
    for pr in prs:
        reviews = pr.get("reviews", [])
        # Skip if fnnitpick already reviewed (any state)
        qa_reviewed = any(r.get("author", {}).get("login") == "fnnitpick" for r in reviews)
        if qa_reviewed:
            continue

        # Check CI passed
        checks = pr.get("statusCheckRollup", [])
        ci_passed = any(
            c.get("name", "").startswith("build-and-test") and c.get("conclusion") == "SUCCESS"
            for c in checks
        )
        if not ci_passed:
            continue

        # Claim the PR review (same protocol as tasks)
        pr_num = pr["number"]
        release_stale_claims(pr_num)
        gh_comment(pr_num, f"CLAIM {WORKER_ID}")
        time.sleep(3)
        if not check_claim_won(pr_num):
            log(f"Lost claim on PR #{pr_num}", C.warning, quiet_ok=True)
            continue

        # Move linked issue to QA In Progress
        issue_num = get_linked_issue(pr_num)
        if issue_num:
            update_board_status(issue_num, "qa_in_progress")
            set_claimed_by(issue_num, WORKER_ID)

        return {"number": pr_num, "title": pr["title"], "linked_issue": issue_num}

    return None


def run_pr_review(pr):
    """Spawn fnnitpick to review a PR."""
    pr_num = pr["number"]
    issue_num = pr.get("linked_issue") or get_linked_issue(pr_num)
    log(f"Reviewing PR #{pr_num}: {pr['title']}", C.success)

    # Get the linked issue number from the PR body
    pr_body = subprocess.run(
        ["gh", "pr", "view", str(pr_num), "--repo", REPO, "--json", "body", "--jq", ".body"],
        capture_output=True, text=True, timeout=30
    )
    issue_refs = re.findall(r"#(\d+)", pr_body.stdout) if pr_body.returncode == 0 else []

    issue_context = ""
    for ref in issue_refs[:3]:  # max 3 linked issues
        issue = subprocess.run(
            ["gh", "issue", "view", ref, "--repo", REPO, "--json", "body,title",
             "--jq", '"## Issue #" + (.number|tostring) + ": " + .title + "\n" + .body'],
            capture_output=True, text=True, timeout=30
        )
        if issue.returncode == 0:
            issue_context += issue.stdout + "\n\n"

    prompt = (
        f"Review PR #{pr_num} in repo {REPO}.\n\n"
        f"FIRST: Read all comments on the PR and linked issue(s) to understand "
        f"the full history — previous reviews, fixes, and context.\n\n"
        f"Read the PR diff with: gh pr diff {pr_num} --repo {REPO}\n\n"
    )
    if issue_context:
        prompt += f"Linked issue specs:\n\n{issue_context}\n\n"
    prompt += (
        "Post your review using gh pr review. Approve if it matches the spec, "
        "request changes if it doesn't. Use the QA bot token for authentication."
    )

    spawn_agent("qa", prompt)

    # Check review outcome and update board
    review_result = subprocess.run(
        ["gh", "pr", "view", str(pr_num), "--repo", REPO,
         "--json", "reviewDecision", "--jq", ".reviewDecision"],
        capture_output=True, text=True, timeout=30
    )
    decision = review_result.stdout.strip() if review_result.returncode == 0 else ""

    if issue_num:
        if decision == "APPROVED":
            update_board_status(issue_num, "awaiting_merge")
        elif decision == "CHANGES_REQUESTED":
            update_board_status(issue_num, "ready_for_dev")
        clear_claimed_by(issue_num)

    gh_comment(pr_num, f"RELEASE {WORKER_ID} — review complete ({decision})")
    return True


# ── Priority 2: Rejected PRs ───────────────────────────────────────

def find_rejected_pr():
    """Find and claim an open PR that needs fixing (QA rejected, CI failed, or merge conflicts)."""
    result = subprocess.run(
        ["gh", "pr", "list", "--repo", REPO, "--state", "open",
         "--json", "number,title,reviews,headRefName,statusCheckRollup,mergeable"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0 or not result.stdout.strip():
        return None

    prs = json.loads(result.stdout)
    for pr in prs:
        reviews = pr.get("reviews", [])
        qa_reviews = [r for r in reviews
                      if r.get("author", {}).get("login") in ("fnnitpick",)]

        review_body = ""
        needs_fix = False

        # Check 1: fnnitpick requested changes
        if qa_reviews:
            latest = qa_reviews[-1]
            if latest.get("state") == "CHANGES_REQUESTED":
                needs_fix = True
                review_body = latest.get("body", "")

        # Check 2: CI failed
        if not needs_fix:
            checks = pr.get("statusCheckRollup", [])
            ci_failed = any(
                c.get("name", "").startswith("build-and-test") and c.get("conclusion") == "FAILURE"
                for c in checks
            )
            if ci_failed:
                needs_fix = True
                review_body = "CI build/test failed. Check the CI logs and fix the issues."

        # Check 3: Merge conflicts with main
        if not needs_fix:
            if pr.get("mergeable") == "CONFLICTING":
                needs_fix = True
                review_body = (
                    "This PR has merge conflicts with main. "
                    "Rebase onto main and resolve all conflicts, then push."
                )

        if not needs_fix:
            continue

        pr_num = pr["number"]
        release_stale_claims(pr_num)
        gh_comment(pr_num, f"CLAIM {WORKER_ID}")
        time.sleep(3)
        if not check_claim_won(pr_num):
            log(f"Lost claim on PR #{pr_num} fix", C.warning, quiet_ok=True)
            continue

        # Move linked issue to Dev In Progress (claiming)
        issue_num = get_linked_issue(pr_num)
        if issue_num:
            update_board_status(issue_num, "dev_in_progress")
            set_claimed_by(issue_num, WORKER_ID)

        return {
            "number": pr_num,
            "title": pr["title"],
            "branch": pr.get("headRefName", ""),
            "review_body": review_body,
            "linked_issue": issue_num,
        }

    return None


def run_pr_fix(pr):
    """Spawn fn10x to fix a rejected PR."""
    pr_num = pr["number"]
    log(f"Fixing rejected PR #{pr_num}: {pr['title']}", C.warning)

    # Create or reuse worktree — check for any existing worktree for this PR
    branch = pr["branch"]
    os.makedirs(WORKTREE_DIR, exist_ok=True)
    worktree_info = ""

    existing_path, existing_branch = find_existing_worktree("pr", pr_num)
    if existing_path:
        worktree_path = existing_path
        log(f"Reusing existing worktree for PR #{pr_num}", C.info, quiet_ok=True)
        subprocess.run(["git", "-C", worktree_path, "pull", "--ff-only"],
                       capture_output=True, text=True, timeout=30)
        worktree_info = f"Work in this directory: {worktree_path} (branch: {branch}). Previous work may exist — check git status and continue from where it left off. "
    else:
        worktree_path = os.path.join(WORKTREE_DIR, f"pr-{pr_num}")
        subprocess.run(["git", "fetch", "origin", branch],
                       capture_output=True, text=True, timeout=30)
        wt_result = subprocess.run(
            ["git", "worktree", "add", worktree_path, f"origin/{branch}"],
            capture_output=True, text=True, timeout=30
        )
        if wt_result.returncode == 0:
            worktree_info = f"Work in this directory: {worktree_path} (branch: {branch}). "
        else:
            log(f"Worktree failed: {wt_result.stderr.strip()}", C.warning)

    # Get linked issue spec
    pr_body = subprocess.run(
        ["gh", "pr", "view", str(pr_num), "--repo", REPO, "--json", "body", "--jq", ".body"],
        capture_output=True, text=True, timeout=30
    )
    issue_refs = re.findall(r"#(\d+)", pr_body.stdout) if pr_body.returncode == 0 else []
    issue_context = ""
    for ref in issue_refs[:3]:
        issue = subprocess.run(
            ["gh", "issue", "view", ref, "--repo", REPO, "--json", "body,title",
             "--jq", '"## Issue #" + (.number|tostring) + ": " + .title + "\n" + .body'],
            capture_output=True, text=True, timeout=30
        )
        if issue.returncode == 0:
            issue_context += issue.stdout + "\n\n"

    codebase = get_codebase_context()

    prompt = (
        f"PR #{pr_num} was rejected by the QA reviewer. Fix the issues and push to the same branch.\n\n"
        f"FIRST: Read all comments on the PR and linked issue(s) to understand "
        f"the full history — previous reviews, fixes, and what other workers have already done.\n\n"
        f"{worktree_info}\n\n"
        f"QA review feedback:\n{pr['review_body']}\n\n"
    )
    if issue_context:
        prompt += f"Original issue specs:\n\n{issue_context}\n\n"
    prompt += f"## Codebase context (cached — do NOT re-explore these files)\n\n{codebase}\n\n"
    prompt += (
        f"Read the full PR diff: gh pr diff {pr_num} --repo {REPO}\n"
        f"Fix the issues raised in the review, then push to branch {branch}.\n\n"
        f"## MANDATORY before every push\n\n"
        f"Run `pnpm run build && pnpm run test` and verify BOTH pass with zero errors. "
        f"Do NOT push if either fails — fix the issue first. "
        f"CI will reject broken code and you'll have to fix it anyway.\n\n"
        f"Commit frequently so work is preserved if interrupted. "
        f"Push after each meaningful chunk — but ONLY after build+test pass."
    )

    issue_num = pr.get("linked_issue") or (int(issue_refs[0]) if issue_refs else None)
    hb_stop = threading.Event()
    if issue_num:
        hb_thread = threading.Thread(target=heartbeat_loop, args=(issue_num, hb_stop), daemon=True)
        hb_thread.start()
    try:
        spawn_agent("code", prompt)
        if STOP_REQUESTED and issue_num:
            pushed = subprocess.run(
                ["git", "-C", worktree_path, "log", "--oneline", f"origin/main..{branch}"],
                capture_output=True, text=True, timeout=10
            ) if worktree_path else None
            summary = pushed.stdout.strip() if pushed and pushed.returncode == 0 else "(no commits pushed)"
            gh_comment(pr_num, f"RELEASE {WORKER_ID} — graceful stop, work so far:\n{summary}")
            update_board_status(issue_num, "ready_for_dev")
        else:
            gh_comment(pr_num, f"RELEASE {WORKER_ID} — PR fix complete")
            if issue_num:
                update_board_status(issue_num, "ready_for_qa")
        if issue_num:
            clear_claimed_by(issue_num)
        return True
    finally:
        hb_stop.set()


# ── Priority 3: Ready tasks ────────────────────────────────────────

# Sentinel: tasks exist but all are claimed/blocked — don't run triage
ALL_BUSY = "ALL_BUSY"


def find_ready_task():
    """Find and claim a task from the 'Ready for Dev' board column.
    Returns task dict, None (no tasks exist), or ALL_BUSY (tasks exist but unavailable)."""
    lock_fd = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX)

        items = query_board_items("ready_for_dev")
        if not items:
            return None

        # Filter to unclaimed items and fetch priorities
        tasks = []
        for item in items:
            if item.get("claimed_by"):
                continue
            num = item["number"]
            result = subprocess.run(
                ["gh", "issue", "view", str(num), "--repo", REPO,
                 "--json", "labels", "--jq",
                 '.labels | map(.name) | map(select(startswith("P"))) | .[0] // "P9"'],
                capture_output=True, text=True, timeout=30
            )
            priority = result.stdout.strip() if result.returncode == 0 else "P9"
            tasks.append({
                "number": num, "title": item["title"],
                "priority": priority, "item_id": item["item_id"],
            })

        if not tasks:
            return ALL_BUSY

        tasks.sort(key=lambda t: t.get("priority", "P9"))

        for chosen in tasks:
            issue_num = chosen["number"]

            if is_blocked(issue_num):
                if VERBOSE:
                    log(f"#{issue_num} is blocked, skipping...", quiet_ok=True)
                continue

            release_stale_claims(issue_num)
            gh_comment(issue_num, f"CLAIM {WORKER_ID}")
            time.sleep(3)

            if not check_claim_won(issue_num):
                log(f"Lost claim on #{issue_num}", C.warning, quiet_ok=True)
                continue

            # Won — move to Dev In Progress and set Claimed By
            item_id = chosen.get("item_id")
            update_board_status(issue_num, "dev_in_progress", item_id=item_id)
            set_claimed_by(issue_num, WORKER_ID, item_id=item_id)

            log(f"Claimed #{issue_num}: {chosen.get('title', '?')}", C.success)
            return chosen

        return ALL_BUSY

    except Exception as e:
        log(f"Error claiming task: {e}", C.error)
        return None
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()


def run_new_task(task):
    """Spawn fn10x for a new task."""
    issue_num = task["number"]

    # Create or reuse worktree — check for any existing worktree for this issue
    worktree_info = ""
    os.makedirs(WORKTREE_DIR, exist_ok=True)

    existing_path, existing_branch = find_existing_worktree("issue", issue_num)
    if existing_path:
        worktree_path = existing_path
        worktree_branch = existing_branch or f"feat/issue-{issue_num}"
        log(f"Reusing existing worktree for #{issue_num}", C.info, quiet_ok=True)
        worktree_info = f"Work in this directory: {worktree_path} (branch: {worktree_branch}). Previous work may exist — check git status and continue from where it left off. "
    else:
        worktree_branch = f"feat/issue-{issue_num}"
        worktree_path = os.path.join(WORKTREE_DIR, f"issue-{issue_num}")
        wt_result = subprocess.run(
            ["git", "worktree", "add", worktree_path, "-b", worktree_branch],
            capture_output=True, text=True, timeout=30
        )
        if wt_result.returncode == 0:
            worktree_info = f"Work in this directory: {worktree_path} (branch: {worktree_branch}). "
        else:
            log(f"Worktree failed: {wt_result.stderr.strip()}", C.warning)

    # Read issue spec
    issue = subprocess.run(
        ["gh", "issue", "view", str(issue_num), "--repo", REPO,
         "--json", "body,title", "--jq", '.title + "\n\n" + .body'],
        capture_output=True, text=True, timeout=30
    )
    spec = issue.stdout.strip() if issue.returncode == 0 else f"Issue #{issue_num}"

    codebase = get_codebase_context()

    prompt = (
        f"Implement issue #{issue_num} in repo {REPO}.\n\n"
        f"FIRST: Read all comments on the issue to understand the full history — "
        f"previous attempts, reviewer feedback, and what other workers have already done. "
        f"Run: gh issue view {issue_num} --repo {REPO} --json comments\n\n"
        f"{worktree_info}\n\n"
        f"## Spec\n\n{spec}\n\n"
        f"## Codebase context (cached — do NOT re-explore these files)\n\n{codebase}\n\n"
        f"You already have the full source of all key files above. "
        f"Start implementing immediately — do not explore the codebase.\n\n"
        f"Write tests first, then implementation.\n\n"
        f"## MANDATORY before every push\n\n"
        f"Run `pnpm run build && pnpm run test` and verify BOTH pass with zero errors. "
        f"Do NOT push if either fails — fix the issue first. "
        f"CI will reject broken code and you'll have to fix it anyway.\n\n"
        f"Commit frequently so work is preserved if interrupted. "
        f"Push after each meaningful chunk — but ONLY after build+test pass.\n\n"
        f"Create a PR targeting main when done. Reference #{issue_num} in the PR body."
    )

    hb_stop = threading.Event()
    hb_thread = threading.Thread(target=heartbeat_loop, args=(issue_num, hb_stop), daemon=True)
    hb_thread.start()
    try:
        result = spawn_agent("code", prompt)
    finally:
        hb_stop.set()

    # Release the task
    if STOP_REQUESTED:
        # Summarize pushed work for the next worker
        pushed = subprocess.run(
            ["git", "-C", worktree_path, "log", "--oneline", f"origin/main..{worktree_branch}"],
            capture_output=True, text=True, timeout=10
        ) if worktree_path else None
        summary = pushed.stdout.strip() if pushed and pushed.returncode == 0 else "(no commits pushed)"
        gh_comment(issue_num, f"RELEASE {WORKER_ID} — graceful stop, work so far:\n{summary}")
        update_board_status(issue_num, "ready_for_dev")
        clear_claimed_by(issue_num)
        log(f"#{issue_num} released back to Ready for Dev", C.warning)
    else:
        gh_comment(issue_num, f"RELEASE {WORKER_ID} — work complete")
        update_board_status(issue_num, "ready_for_qa")
        clear_claimed_by(issue_num)

    return result


# ── Priority 4: Triage ─────────────────────────────────────────────

def run_triage():
    """Run triage when no work is available. Returns True if new work was created."""
    if os.path.exists(TRIAGE_COOLDOWN_FILE):
        age = time.time() - os.path.getmtime(TRIAGE_COOLDOWN_FILE)
        if age < TRIAGE_COOLDOWN:
            if VERBOSE:
                log(f"Triage on cooldown ({int(TRIAGE_COOLDOWN - age)}s remaining)...")
            return False

    lock_fd = open(TRIAGE_LOCK_FILE, "w")
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except (BlockingIOError, OSError):
        if VERBOSE:
            log("Another worker is running triage, skipping...")
        lock_fd.close()
        return False

    try:
        log("No work available — running triage...", C.triage)

        # Snapshot task list before triage so we can detect genuinely new work
        before_items = query_board_items("ready_for_dev")
        before_ids = {item["number"] for item in before_items}

        prompt = (
            "The 'Ready for Dev' board column is empty and no PRs need review or fixing. "
            f"Worker ID: {WORKER_ID}. Repo: {REPO}.\n\n"
            "Do a big-picture review: check milestones, assess gaps, create tasks if needed. "
            "For any new issues you create, add them to project #4 (owner: fnrhombus) "
            "and set their Status to 'Ready for Dev' so workers can pick them up. "
            "If the project is genuinely done, say so."
        )

        spawn_agent("triage", prompt)

        # Check if triage created new work — look for new open issues not on the board
        after = subprocess.run(
            ["gh", "issue", "list", "--repo", REPO, "--state", "open",
             "--json", "number", "--jq", "[.[].number]"],
            capture_output=True, text=True, timeout=30
        )
        all_open = set(json.loads(after.stdout.strip() or "[]")) if after.returncode == 0 else set()
        # Also check board for newly added Ready for Dev items
        after_items = query_board_items("ready_for_dev")
        after_ids = {item["number"] for item in after_items}
        new_ids = after_ids - before_ids
        # Ensure any new issues with agent labels get on the board
        for issue_num in all_open - after_ids - before_ids:
            label_check = subprocess.run(
                ["gh", "issue", "view", str(issue_num), "--repo", REPO,
                 "--json", "labels", "--jq",
                 '.labels | map(.name) | any(startswith("agent:"))'],
                capture_output=True, text=True, timeout=30
            )
            if label_check.stdout.strip() == "true":
                ensure_on_board(issue_num, "ready_for_dev")
                new_ids.add(issue_num)

        if new_ids:
            id_list = ", ".join(f"#{n}" for n in sorted(new_ids))
            log(f"Triage created {len(new_ids)} task(s): {id_list}", C.success)
            if os.path.exists(TRIAGE_COOLDOWN_FILE):
                os.remove(TRIAGE_COOLDOWN_FILE)
            return True
        else:
            log(f"Triage ran but no new tasks. Cooldown {TRIAGE_COOLDOWN}s.", C.dim)
            open(TRIAGE_COOLDOWN_FILE, "w").close()
            return False
    finally:
        fcntl.flock(lock_fd, fcntl.LOCK_UN)
        lock_fd.close()


# ── Agent spawning ──────────────────────────────────────────────────

AGENT_NAMES = {"code": "fn10x", "qa": "fnnitpick", "plan": "fnplanner", "research": "fnlmgtfy"}


def spawn_agent(agent_type, prompt):
    """Spawn a claude agent and wait for it to complete. Returns True."""
    cmd = [
        "claude", "--agent", agent_type,
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
        "message": {"role": "user", "content": prompt}
    })
    proc.stdin.write(init_msg + "\n")
    proc.stdin.flush()

    proc.stdin.close()
    agent_name = AGENT_NAMES.get(agent_type, agent_type)
    done_event = threading.Event()
    out_thread = threading.Thread(target=output_reader, args=(proc, done_event, agent_name), daemon=True)
    out_thread.start()

    done_event.wait(timeout=600)

    if proc.poll() is None:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()

    out_thread.join(timeout=5)
    return True


# ── Claim protocol ──────────────────────────────────────────────────

CLAIM_STALE_THRESHOLD = 300  # 5 minutes — claims older than this are auto-released
HEARTBEAT_INTERVAL = 120  # 2 minutes — post bump before stale threshold


def heartbeat_loop(issue_num, stop_event):
    """Post periodic HEARTBEAT comments while a task is in progress."""
    while not stop_event.wait(HEARTBEAT_INTERVAL):
        if stop_event.is_set():
            break
        gh_comment(issue_num, f"HEARTBEAT {WORKER_ID}")
        if VERBOSE:
            log(f"Heartbeat posted on #{issue_num}", C.dim)


def release_stale_claims(issue_num):
    """Release claims from dead workers (older than CLAIM_STALE_THRESHOLD with no RELEASE/HEARTBEAT)."""
    result = subprocess.run(
        ["gh", "issue", "view", str(issue_num), "--repo", REPO,
         "--json", "comments", "--jq",
         r'.comments | map(select(.body | startswith("CLAIM ") or startswith("RELEASE ") or startswith("HEARTBEAT "))) | .[] | "\(.createdAt)\t\(.body)"'],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0 or not result.stdout.strip():
        return

    lines = [l.strip() for l in result.stdout.strip().split("\n") if l.strip()]
    active_claims = {}  # worker_id -> latest timestamp (CLAIM or HEARTBEAT)

    for line in lines:
        parts = line.split("\t", 1)
        if len(parts) != 2:
            continue
        ts, body = parts
        if body.startswith("CLAIM "):
            worker = body[6:]
            active_claims[worker] = ts
        elif body.startswith("HEARTBEAT "):
            worker = body[10:]
            if worker in active_claims:
                active_claims[worker] = ts  # refresh timestamp
        elif body.startswith("RELEASE "):
            worker = body.split(" ", 1)[1].split(" ", 1)[0]
            active_claims.pop(worker, None)

    now = time.time()
    for worker, ts in active_claims.items():
        if worker == WORKER_ID:
            continue
        try:
            last_seen = datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
            age = now - last_seen
            if age > CLAIM_STALE_THRESHOLD:
                log(f"Releasing stale claim from {worker} on #{issue_num} ({int(age)}s old)", C.warning)
                gh_comment(issue_num, f"RELEASE {worker} — stale claim auto-released by {WORKER_ID}")
                # Bounce issue back to Ready for Dev and clear Claimed By
                is_pr = subprocess.run(
                    ["gh", "pr", "view", str(issue_num), "--repo", REPO,
                     "--json", "number", "--jq", ".number"],
                    capture_output=True, text=True, timeout=30
                )
                if is_pr.returncode != 0:
                    # It's an issue — move back to Ready for Dev
                    update_board_status(issue_num, "ready_for_dev")
                    clear_claimed_by(issue_num)
        except (ValueError, OSError):
            pass


def check_claim_won(issue_num):
    result = subprocess.run(
        ["gh", "issue", "view", str(issue_num), "--repo", REPO,
         "--json", "comments", "--jq",
         '.comments | map(select(.body | startswith("CLAIM ") or startswith("RELEASE "))) | .[] | .body'],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        return False

    lines = [l.strip() for l in result.stdout.strip().split("\n") if l.strip()]
    if not lines:
        return False

    last_release_idx = -1
    for i, line in enumerate(lines):
        if line.startswith("RELEASE "):
            last_release_idx = i

    for line in lines[last_release_idx + 1:]:
        if line.startswith("CLAIM "):
            return line == f"CLAIM {WORKER_ID}"

    return False


def is_blocked(issue_num):
    result = subprocess.run(
        ["gh", "issue", "view", str(issue_num), "--repo", REPO,
         "--json", "body", "--jq", ".body"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0 or not result.stdout.strip():
        return False

    refs = set(int(m) for m in re.findall(r"#(\d+)", result.stdout))
    if not refs:
        return False

    for ref in refs:
        check = subprocess.run(
            ["gh", "issue", "view", str(ref), "--repo", REPO,
             "--json", "state", "--jq", ".state"],
            capture_output=True, text=True, timeout=30
        )
        if check.returncode == 0 and check.stdout.strip() == "OPEN":
            log(f"#{issue_num} blocked on #{ref} (still open)", C.warning, quiet_ok=True)
            return True

    return False


# ── Orphan cleanup ─────────────────────────────────────────────────

def cleanup_orphaned_claims():
    """Find items in 'In Progress' columns with stale claims and bounce them back."""
    for status in ("dev_in_progress", "qa_in_progress"):
        items = query_board_items(status)
        for item in items:
            if not item.get("claimed_by"):
                # In progress but no claim — orphaned, bounce back
                ready = "ready_for_dev" if status == "dev_in_progress" else "ready_for_qa"
                log(f"#{item['number']} orphaned in {status} (no claim), moving to {ready}", C.warning)
                update_board_status(item["number"], ready, item_id=item["item_id"])
                continue
            # Has a claim — check if it's stale
            release_stale_claims(item["number"])


# ── Worktree helpers ───────────────────────────────────────────────

def find_existing_worktree(kind, num):
    """Find any existing worktree for an issue or PR, regardless of naming convention.
    kind: 'issue' or 'pr'. Returns (path, branch) or (None, None)."""
    result = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode != 0:
        return None, None

    pattern = re.compile(rf'(?:^|[-/]){kind}-{num}$')
    current = {}
    for line in result.stdout.split("\n"):
        if line.startswith("worktree "):
            current = {"path": line.split(" ", 1)[1]}
        elif line.startswith("branch "):
            current["branch"] = line.split(" ", 1)[1].replace("refs/heads/", "")
        elif line == "":
            if current.get("path"):
                basename = os.path.basename(current["path"])
                if pattern.search(basename):
                    return current["path"], current.get("branch", "")
            current = {}

    return None, None


def cleanup_worktrees():
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

        # Skip worktrees with active processes
        ps_check = subprocess.run(
            ["fuser", path, "-s"], capture_output=True, timeout=10
        )
        if ps_check.returncode == 0:
            if VERBOSE:
                log(f"Worktree in use, skipping: {path}")
            continue

        # Extract issue/PR number from worktree path to check if still needed
        m = re.search(r'(?:issue|pr)-(\d+)$', os.path.basename(path))
        if m:
            num = m.group(1)
            # Don't clean worktrees for open issues/PRs — work may resume
            state_check = subprocess.run(
                ["gh", "issue", "view", num, "--repo", REPO, "--json", "state", "--jq", ".state"],
                capture_output=True, text=True, timeout=30
            )
            if state_check.returncode == 0 and state_check.stdout.strip() == "OPEN":
                if VERBOSE:
                    log(f"Worktree for open #{num}, keeping: {path}", quiet_ok=True)
                continue

        log(f"Cleaning stale worktree: {path} ({branch})", C.dim, quiet_ok=True)
        subprocess.run(["git", "worktree", "remove", "--force", path],
                       capture_output=True, text=True, timeout=30)
        if branch and branch != "main":
            subprocess.run(["git", "branch", "-D", branch],
                           capture_output=True, text=True, timeout=30)

    # Collect branches that are checked out in worktrees (never delete these)
    worktree_branches = {wt.get("branch", "") for wt in stale}
    worktree_branches.add("main")

    # Clean up old worker-named branches (legacy: {name}/issue-{N})
    result = subprocess.run(
        ["git", "branch", "--format", "%(refname:short)"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode == 0:
        for branch in result.stdout.strip().split("\n"):
            branch = branch.strip()
            if not branch or branch in worktree_branches:
                continue
            # Only delete legacy worker-named branches (e.g. james/issue-28)
            # Keep feat/issue-N branches — those are active feature worktrees
            if branch.startswith("worktree-agent-") or (
                "/issue-" in branch and not branch.startswith("feat/")
            ):
                subprocess.run(["git", "branch", "-D", branch],
                               capture_output=True, text=True, timeout=30)
                if VERBOSE:
                    log(f"Deleted legacy branch: {branch}")

    subprocess.run(["git", "remote", "prune", "origin"],
                   capture_output=True, text=True, timeout=30)


# ── Output/input handling ──────────────────────────────────────────

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
    s = " ".join(s.split())
    return s[:n] + "…" if len(s) > n else s


def output_reader(proc, done_event, agent_name="agent"):
    prefix = f"{WORKER_ID}({agent_name})"

    def alog(msg, color=None):
        if color is None:
            color = C.info
        print(f"{color}{ts()} [{prefix}] {msg}{RESET}")

    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            if VERBOSE:
                alog(line, C.dim)
            continue

        t = msg.get("type", "")

        if t == "system" and msg.get("subtype") == "init":
            if VERBOSE:
                model = msg.get("model", "?")
                alog(f"session: {msg.get('session_id', '?')[:8]}… model: {model}", C.dim)

        elif t == "assistant":
            content = msg.get("message", {}).get("content", [])
            for block in content:
                if block.get("type") == "text":
                    if VERBOSE:
                        for text_line in block["text"].strip().split("\n"):
                            alog(text_line, C.emphasis)
                    else:
                        for para in block["text"].strip().split("\n"):
                            para = para.strip()
                            if para:
                                alog(para)
                                break
                elif block.get("type") == "tool_use" and VERBOSE:
                    name = block.get("name", "?")
                    inp = block.get("input", {})
                    desc = format_tool_input(name, inp)
                    alog(f"▶ {name} {C.dim}{truncate(desc)}", C.tool)

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
                    alog(f"✗ {truncate(stderr)}", C.error)
                elif is_error:
                    alog(f"✗ {truncate(stdout or stderr)}", C.error)
                elif stdout:
                    alog(f"✓ {truncate(stdout)}", C.tool_ok)

        elif t == "result":
            cost = msg.get("total_cost_usd", 0)
            dur = msg.get("duration_ms", 0) / 1000
            turns = msg.get("num_turns", 0)
            alog(f"done: {turns} turns, {dur:.1f}s, ${cost:.4f}", C.dim)
            done_event.set()

    sys.stdout.flush()



# ── Main loop ───────────────────────────────────────────────────────

def handle_sigint(signum, frame):
    global STOP_REQUESTED
    if STOP_REQUESTED:
        print(f"\n{C.error}[{WORKER_ID}] Force killed.{RESET}")
        sys.exit(1)
    STOP_REQUESTED = True
    log("Graceful stop requested — finishing current task, then exiting. (ctrl+c again to force kill)", C.warning)


def handle_sigusr1(signum, frame):
    global VERBOSE
    VERBOSE = not VERBOSE
    log(f"Verbose {'ON' if VERBOSE else 'OFF'}", C.emphasis)


def handle_sigusr2(signum, frame):
    global QUIET
    QUIET = not QUIET
    log(f"Quiet {'ON' if QUIET else 'OFF'}", C.emphasis)


def _signal_scale_up():
    if _scale_queue:
        _scale_queue.put("scale_up")


def run_cycle():
    """Run one dispatch cycle. Returns True if work was done, False if idle."""

    # Priority 0: Merge approved PRs (no agent needed, just gh pr merge)
    pr = find_mergeable_pr()
    if pr:
        merge_pr(pr)
        return True

    # Priority 1: PRs needing review
    pr = find_pr_needing_review()
    if pr:
        _signal_scale_up()
        run_pr_review(pr)
        return True

    # Priority 2: Rejected PRs or CI failures needing fixes
    pr = find_rejected_pr()
    if pr:
        _signal_scale_up()
        run_pr_fix(pr)
        return True

    # Priority 3: Ready tasks
    task = find_ready_task()
    if task is ALL_BUSY:
        log("All tasks claimed or blocked. Nothing for this worker to do.", C.info, quiet_ok=True)
        return False
    if task:
        _signal_scale_up()
        run_new_task(task)
        return True

    # Priority 4: Triage (only when no tasks exist at all)
    return run_triage()


EXIT_NO_WORK = 42

_scale_queue = None


def run_worker_process(args_ns, color_index, scale_queue=None):
    """Entry point for each worker subprocess. Runs one dispatch cycle and exits."""
    global VERBOSE, QUIET, WORKER_ID, C, _scale_queue
    VERBOSE = args_ns.verbose
    QUIET = args_ns.quiet
    _scale_queue = scale_queue
    _num = random.randint(10000, 99999)
    WORKER_ID = f"{WORKER_NAMES[_num % len(WORKER_NAMES)]}-{_num}"
    C = WorkerColors(color_index)
    signal.signal(signal.SIGINT, handle_sigint)
    signal.signal(signal.SIGUSR1, handle_sigusr1)
    signal.signal(signal.SIGUSR2, handle_sigusr2)

    swatch = f"{C.emphasis}██{C.success}██{C.warning}██{C.tool}██{C.info}██{C.dim}██{RESET}"
    log(f"Starting {swatch}", C.emphasis, quiet_ok=True)

    if STOP_REQUESTED:
        log("Stop requested before starting.", C.warning)
        sys.exit(0)

    cleanup_worktrees()
    cleanup_orphaned_claims()
    work_done = run_cycle()
    log("Cycle complete." if work_done else "No work found.", C.dim, quiet_ok=True)
    sys.exit(0 if work_done else EXIT_NO_WORK)


def main():
    global VERBOSE, QUIET
    parser = argparse.ArgumentParser(description="fntypescript worker swarm")
    parser.add_argument("-v", "--verbose", action="store_true",
                        help="Show full claude output")
    parser.add_argument("-q", "--quiet", action="store_true",
                        help="Suppress idle/no-work output")
    parser.add_argument("-w", "--max-workers", type=int, default=0, metavar="N",
                        help="Maximum concurrent workers (0 = unlimited, default: 0)")
    args = parser.parse_args()
    VERBOSE = args.verbose
    QUIET = args.quiet

    # ── Supervisor mode ────────────────────────────────────────────
    global WORKER_ID, C
    import multiprocessing
    WORKER_ID = "supervisor"
    C = SupervisorColors()

    child_processes = []

    def keyboard_listener():
        import tty, termios
        try:
            fd = sys.stdin.fileno()
            old = termios.tcgetattr(fd)
        except (termios.error, OSError, ValueError):
            return  # not a terminal
        try:
            tty.setcbreak(fd)
            while True:
                ch = sys.stdin.read(1)
                if ch == '\x0f':  # ctrl+o
                    for p in child_processes:
                        if p.is_alive():
                            os.kill(p.pid, signal.SIGUSR1)
                    handle_sigusr1(None, None)
                elif ch == '\x1c':  # ctrl+\
                    for p in child_processes:
                        if p.is_alive():
                            os.kill(p.pid, signal.SIGUSR2)
                    handle_sigusr2(None, None)
        except (EOFError, OSError):
            pass
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)

    threading.Thread(target=keyboard_listener, daemon=True).start()
    log("ctrl+o verbose, ctrl+\\ quiet", C.dim)

    scale_queue = multiprocessing.Queue()
    max_workers = args.max_workers
    processes = child_processes
    stopping = False
    next_color = 0
    last_spawn = 0.0
    PROBE_INTERVAL = 90

    def alive_count():
        return sum(1 for p in processes if p.is_alive())

    def at_cap():
        return max_workers and alive_count() >= max_workers

    def spawn_worker():
        nonlocal next_color, last_spawn
        if stopping or at_cap():
            return
        p = multiprocessing.Process(target=run_worker_process, args=(args, next_color, scale_queue))
        next_color += 1
        p.start()
        processes.append(p)
        last_spawn = time.time()
        n = alive_count()
        log(f"Started worker ({n} active{', max ' + str(max_workers) if max_workers else ''})", C.emphasis)

    spawn_worker()

    try:
        while True:
            # Reap finished workers and check exit codes
            still_alive = []
            any_did_work = False
            for p in processes:
                if p.is_alive():
                    still_alive.append(p)
                else:
                    p.join()
                    if p.exitcode != EXIT_NO_WORK:
                        any_did_work = True
            processes[:] = still_alive

            # Drain scale-up signals
            scale_signal = False
            while True:
                try:
                    scale_queue.get_nowait()
                    scale_signal = True
                except Exception:
                    break

            if not stopping:
                # Scale up on signal
                if scale_signal:
                    spawn_worker()

                # Respawn immediately when a worker finished work
                if any_did_work and not processes:
                    spawn_worker()

                # Proactive probe when idle
                if not processes and time.time() - last_spawn >= PROBE_INTERVAL:
                    spawn_worker()

            # Exit when all workers done and stopping
            if stopping and not processes:
                break

            time.sleep(1)

    except KeyboardInterrupt:
        stopping = True
        log("Graceful stop — waiting for workers to finish. (ctrl+c to force kill)", C.warning)
        try:
            for p in processes:
                if p.is_alive():
                    p.join()
        except KeyboardInterrupt:
            log("Force killing all workers.", C.error)
            for p in processes:
                if p.is_alive():
                    p.terminate()


if __name__ == "__main__":
    main()
