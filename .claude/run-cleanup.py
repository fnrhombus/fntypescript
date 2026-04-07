#!/usr/bin/env python3
"""Clean up orphaned worktrees, branches, stale claims, and diagnose pipeline issues.

Run this when no workers are active to reset pipeline state.
"""
import argparse
import json
import os
import re
import subprocess
import sys

REPO = "fnrhombus/fntypescript"
WORKTREE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "worktrees")

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
            ... on ProjectV2ItemFieldSingleSelectValue { optionId name }
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


def run(cmd, **kwargs):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=30, **kwargs)


def update_board_status(item_id, status):
    option_id = BOARD_STATUS.get(status)
    if not option_id or not item_id:
        return
    run(["gh", "project", "item-edit",
         "--project-id", PROJECT_ID, "--id", item_id,
         "--field-id", STATUS_FIELD_ID,
         "--single-select-option-id", option_id])


def clear_claimed_by(item_id):
    if not item_id:
        return
    run(["gh", "api", "graphql", "-f",
         f'query=mutation {{ clearProjectV2ItemFieldValue(input: {{projectId: "{PROJECT_ID}", itemId: "{item_id}", fieldId: "{CLAIMED_BY_FIELD_ID}"}}) {{ projectV2Item {{ id }} }} }}'])


def main():
    parser = argparse.ArgumentParser(description="Clean up orphaned worker state")
    parser.add_argument("-y", "--yes", action="store_true",
                        help="Assert that no workers are running right now")
    parser.add_argument("--skip-diagnose", action="store_true",
                        help="Skip the diagnostic Claude agent at the end")
    args = parser.parse_args()

    if not args.yes:
        answer = input("Do you assert that no workers are running right now? [y/N] ")
        if answer.strip().lower() not in ("y", "yes"):
            print("Stop all workers first, then run this again.")
            sys.exit(1)

    # ── Worktrees ──────────────────────────────────────────────────
    print("=== Worktrees ===")
    wt_result = run(["git", "worktree", "list", "--porcelain"])
    if wt_result.returncode != 0:
        print("Failed to list worktrees")
        sys.exit(1)

    main_wt = None
    worktrees = []
    current = {}
    for line in wt_result.stdout.split("\n"):
        if line.startswith("worktree "):
            current = {"path": line.split(" ", 1)[1]}
        elif line.startswith("branch "):
            current["branch"] = line.split(" ", 1)[1].replace("refs/heads/", "")
        elif line == "":
            if current.get("path"):
                if main_wt is None:
                    main_wt = current["path"]
                else:
                    worktrees.append(current)
            current = {}

    removed = 0
    for wt in worktrees:
        path = wt["path"]
        branch = wt.get("branch", "(detached)")
        print(f"  Removing: {path} ({branch})")
        run(["git", "worktree", "remove", "--force", path])
        removed += 1
    print(f"  Removed {removed} worktrees")

    # ── Branches ───────────────────────────────────────────────────
    print("\n=== Branches ===")
    br_result = run(["git", "branch", "--format", "%(refname:short)"])
    deleted = 0
    if br_result.returncode == 0:
        for branch in br_result.stdout.strip().split("\n"):
            branch = branch.strip()
            if not branch or branch == "main":
                continue
            if branch.startswith(("feat/", "worktree-agent-")) or "/issue-" in branch:
                print(f"  Deleting: {branch}")
                run(["git", "branch", "-D", branch])
                deleted += 1
    print(f"  Deleted {deleted} branches")

    run(["git", "remote", "prune", "origin"])
    print("  Pruned remote tracking branches")

    # ── Board: clear claims and fix columns ────────────────────────
    print("\n=== Board cleanup ===")
    result = run(["gh", "api", "graphql", "-f", f"query={BOARD_QUERY}"])
    if result.returncode != 0:
        print("  Failed to query board")
    else:
        data = json.loads(result.stdout)
        items = data.get("data", {}).get("node", {}).get("items", {}).get("nodes", [])

        # Get open PR bodies to check for linked issues
        pr_result = run(["gh", "pr", "list", "--repo", REPO, "--state", "open",
                         "--json", "number,body"])
        pr_data = json.loads(pr_result.stdout) if pr_result.returncode == 0 and pr_result.stdout.strip() else []
        pr_linked_issues = set()
        for pr in pr_data:
            for ref in re.findall(r"#(\d+)", pr.get("body", "")):
                pr_linked_issues.add(int(ref))

        fixed = 0
        for item in items:
            content = item.get("content")
            if not content:
                continue
            num = content.get("number")
            state = content.get("state", "")
            status = item.get("status")
            claimed = item.get("claimedBy")
            status_name = status.get("name", "") if status else ""
            claimed_by = claimed.get("text", "") if claimed else ""
            item_id = item["id"]

            # Clear all Claimed By fields (no workers running)
            if claimed_by:
                print(f"  #{num}: clearing stale claim from {claimed_by}")
                clear_claimed_by(item_id)
                fixed += 1

            # Bounce 'In Progress' items back to Ready (no workers to work them)
            if state == "OPEN" and "In Progress" in status_name:
                if status_name == "Dev In Progress":
                    target = "ready_for_dev"
                else:
                    target = "ready_for_qa"
                # But if issue has an open PR, it should be Ready for QA
                if num in pr_linked_issues:
                    target = "ready_for_qa"
                print(f"  #{num}: {status_name} → {target} (no workers running)")
                update_board_status(item_id, target)
                fixed += 1

            # Move closed items to Done
            if state == "CLOSED" and status_name != "Done":
                print(f"  #{num}: closed but in '{status_name}' → Done")
                update_board_status(item_id, "done")
                fixed += 1

        print(f"  Fixed {fixed} board items")

    # ── Stale PR claims ────────────────────────────────────────────
    print("\n=== Stale PR claims ===")
    pr_claim_result = run([
        "gh", "pr", "list", "--repo", REPO, "--state", "open",
        "--json", "number,title",
    ])
    pr_fixed = 0
    if pr_claim_result.returncode == 0 and pr_claim_result.stdout.strip():
        prs = json.loads(pr_claim_result.stdout)
        for pr in prs:
            num = pr["number"]
            comments = run([
                "gh", "pr", "view", str(num), "--repo", REPO,
                "--json", "comments", "--jq",
                '.comments | map(select(.body | startswith("CLAIM ") or startswith("RELEASE "))) | .[-1].body // ""',
            ])
            last = comments.stdout.strip() if comments.returncode == 0 else ""
            if last.startswith("CLAIM "):
                worker = last[6:]
                print(f"  PR #{num}: stale claim from {worker} — releasing")
                run(["gh", "api", f"repos/{REPO}/issues/{num}/comments",
                     "-f", f"body=RELEASE {worker} — stale claim cleaned up by run-cleanup"])
                pr_fixed += 1
    print(f"  Fixed {pr_fixed} stale PR claims")

    # ── Diagnostic ─────────────────────────────────────────────────
    if not args.skip_diagnose:
        print("\n=== Pipeline diagnostic ===")
        print("  Spawning Claude to analyze pipeline state...")
        prompt = (
            "You are a pipeline diagnostic agent. Analyze the current state of the "
            f"fnrhombus/fntypescript project and figure out why work isn't progressing.\n\n"
            "Check ALL of the following:\n"
            "1. Open PRs: merge state, CI status, review status, auto-merge status\n"
            "2. Branch protection rules (gh api repos/fnrhombus/fntypescript/branches/main/protection)\n"
            "3. Project board state vs actual PR/issue state (are columns accurate?)\n"
            "4. Any issues that should be progressing but aren't\n"
            "5. CI workflow configuration (.github/workflows/ci.yml) — do required checks match actual check names?\n\n"
            "For each problem found, explain:\n"
            "- What's wrong\n"
            "- Why it's blocking progress\n"
            "- The exact fix (gh commands, config changes, etc.)\n\n"
            "Be thorough. The last time this was skipped, PRs sat blocked for hours "
            "because the required CI check name didn't match the matrix job names."
        )
        try:
            diag = subprocess.run(
                ["claude", "--print", "-p", prompt, "--output-format", "text"],
                text=True, timeout=300,
            )
        except subprocess.TimeoutExpired:
            print("  Diagnostic timed out (5 min)")
        except FileNotFoundError:
            print("  claude CLI not found, skipping diagnostic")

    print("\nDone.")


if __name__ == "__main__":
    main()
