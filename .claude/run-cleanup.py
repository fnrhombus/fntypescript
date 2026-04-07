#!/usr/bin/env python3
"""Clean up orphaned worktrees, branches, and stale claims.

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


def run(cmd, **kwargs):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=30, **kwargs)


def main():
    parser = argparse.ArgumentParser(description="Clean up orphaned worker state")
    parser.add_argument("-y", "--yes", action="store_true",
                        help="Assert that no workers are running right now")
    args = parser.parse_args()

    if not args.yes:
        answer = input("Do you assert that no workers are running right now? [Y/n] ")
        if answer.strip().lower() in ("n", "no"):
            print("Stop all workers first, then run this again.")
            sys.exit(1)

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

    print("\n=== Branches ===")
    br_result = run(["git", "branch", "--format", "%(refname:short)"])
    deleted = 0
    if br_result.returncode == 0:
        for branch in br_result.stdout.strip().split("\n"):
            branch = branch.strip()
            if not branch or branch == "main":
                continue
            # Delete any non-main local branch (feat/, worker-named, etc.)
            if branch.startswith(("feat/", "worktree-agent-")) or "/issue-" in branch:
                print(f"  Deleting: {branch}")
                run(["git", "branch", "-D", branch])
                deleted += 1
    print(f"  Deleted {deleted} branches")

    run(["git", "remote", "prune", "origin"])
    print("  Pruned remote tracking branches")

    print("\n=== Stale claims ===")
    issue_result = run([
        "gh", "issue", "list", "--repo", REPO, "--state", "open",
        "--json", "number,title,labels",
    ])
    if issue_result.returncode != 0 or not issue_result.stdout.strip():
        print("  No open issues found")
        return

    issues = json.loads(issue_result.stdout)
    # Get open PR bodies to check for linked issues
    pr_result = run([
        "gh", "pr", "list", "--repo", REPO, "--state", "open",
        "--json", "body",
    ])
    pr_bodies = ""
    if pr_result.returncode == 0 and pr_result.stdout.strip():
        pr_bodies = pr_result.stdout

    fixed = 0
    for issue in issues:
        num = issue["number"]
        labels = [l["name"] for l in issue.get("labels", [])]
        has_agent = any(l.startswith("agent:") for l in labels)

        if has_agent:
            continue

        # Skip if an open PR references this issue
        if f"#{num}" in pr_bodies:
            print(f"  #{num}: has open PR, skipping")
            continue

        # Check for stale claims
        comments = run([
            "gh", "issue", "view", str(num), "--repo", REPO,
            "--json", "comments", "--jq",
            '.comments | map(select(.body | startswith("CLAIM ") or startswith("RELEASE "))) | .[-1].body // ""',
        ])
        last = comments.stdout.strip() if comments.returncode == 0 else ""
        if last.startswith("CLAIM "):
            worker = last[6:]
            print(f"  #{num}: stale claim from {worker} — releasing and re-adding agent:fn10x")
            run(["gh", "api", f"repos/{REPO}/issues/{num}/comments",
                 "-f", f"body=RELEASE {worker} — stale claim cleaned up by run-cleanup"])
            run(["gh", "issue", "edit", str(num), "--add-label", "agent:fn10x", "--repo", REPO])
            fixed += 1
        else:
            print(f"  #{num}: no agent label, no stale claim, no open PR — may need manual triage")

    print(f"  Fixed {fixed} orphaned claims")
    print("\nDone.")


if __name__ == "__main__":
    main()
