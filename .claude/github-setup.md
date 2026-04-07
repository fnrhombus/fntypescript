# GitHub Configuration for Worker Pipeline

Everything here was configured manually and will need to be automated when extracting the worker pipeline into its own project.

## Repository Settings

### Branch Protection (`main`)
- Required status checks: `build-and-test` (rollup job, not matrix jobs)
- Strict mode: **OFF** (allows merging behind branches — required for parallel PR flow)
- Required reviews: 1
- Dismiss stale reviews: **ON**
- Require code owner reviews: OFF
- Require last push approval: OFF
- Enforce admins: OFF

### Secrets
- `PROJECT_TOKEN` — Classic PAT with `project` scope (read/write). Used by `board-sync.yml` Action to update Projects V2 board. Default `GITHUB_TOKEN` can't modify Projects V2.

## GitHub Actions Workflows

### `ci.yml`
- Matrix job `build-and-test-matrix` runs on node 18, 20, 22
- Rollup job `build-and-test` depends on matrix, reports single pass/fail
- The rollup job exists because branch protection matches exact check names — matrix job names include `(18)`, `(20)`, `(22)` suffixes that don't match `build-and-test`

### `board-sync.yml`
- Triggers on `pull_request_review` (submitted)
- On approved: moves linked issue to "Awaiting Merge"
- On changes_requested: moves linked issue to "Ready for Dev"
- Extracts linked issue number from PR body (`#N` reference)
- Requires `PROJECT_TOKEN` secret

## Projects V2 Board (project #4)

### Column/Status Field
Field ID: `PVTSSF_lAHOACZSnM4BTvD0zhA7-Rg`

| Column | Option ID | Description |
|--------|-----------|-------------|
| Backlog | `a233181e` | Not yet prioritized |
| Ready for Dev | `22da6746` | Spec ready, waiting for fn10x |
| Dev In Progress | `790d1811` | fn10x claimed it |
| Ready for QA | `53d6c465` | PR created, waiting for fnnitpick |
| QA In Progress | `c387ab6b` | fnnitpick reviewing |
| Awaiting Merge | `a2e44fab` | Approved, auto-merge queued |
| Done | `d964e466` | Merged and closed |

### Custom Fields
- **Claimed By** (text) — Field ID: `PVTF_lAHOACZSnM4BTvD0zhBFwmQ`. Set to worker name when claimed, cleared on release.
- **Priority** (single select) — P0, P1, P2
- **Type** (single select) — bug, feature, chore, docs

### Project Workflows (configured in UI)

| Workflow | Enabled | Configuration |
|----------|---------|---------------|
| Item closed | ON | → Status: Done |
| Auto-close issue | ON | When status → Done, close the issue |
| Item reopened | ON | → Status: Backlog |
| Auto-add to project | ON | Filter: `is:issue` (NOT PRs) from fntypescript repo |
| Item added to project | ON | Issues only → Status: Backlog |
| Auto-add sub-issues | ON | (default) |
| Code changes requested | ON/OFF | Inert — no PRs on board. `board-sync.yml` Action handles this for issues instead |
| Pull request merged | ON/OFF | Inert — no PRs on board. Issue closure handled by Item closed → Done |
| Pull request linked to issue | ON/OFF | Inert — no PRs on board |

### Project IDs
- Project ID: `PVT_kwHOACZSnM4BTvD0`
- Project number: 4
- Owner: `fnrhombus`

## What Needs Automation

When extracting this pipeline for reuse, a setup script must:
1. Create the Projects V2 board with the correct columns and fields
2. Configure project workflows (currently UI-only — may need GraphQL workarounds)
3. Set branch protection rules via API
4. Create the `PROJECT_TOKEN` secret (user provides PAT, script stores it)
5. Generate `ci.yml` with rollup job matching the required check name
6. Generate `board-sync.yml` with correct project/field IDs
7. Populate all IDs (project, field, option) into the worker pipeline config — these are currently hardcoded
