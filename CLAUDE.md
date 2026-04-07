# fntypescript

A general-purpose TypeScript Language Service plugin framework — stable extension points for TS tooling authors.

## Working Guidelines

- **Token efficiency is mandatory** — Always operate as token-efficient as absolutely possible without sacrificing result quality.
- **No guessing** — If you don't know what to do, or encounter an error you don't immediately understand, do a brief web search before trying anything. Only after research may you begin experimenting.
- **No speculative creation** — Never create files, features, or structures you aren't sure about. If there's any uncertainty about what to make, ask the user first.

## Monorepo Structure

pnpm workspaces + Turborepo.

```
packages/
  fntypescript/     — core library (the published package)
  tests/            — unit + integration tests
examples/           — example projects (workspace members)
```

- `pnpm run build` — build all packages
- `pnpm run test` — build then test
- Core package has NO test dependencies. Tests live in `@fntypescript/tests`.

## Environment

- **mise manages toolchains** — A `.mise.toml` in the project root defines node, pnpm, and python versions. Tools are available on PATH via mise shims — use `pnpm`, `node`, `python3` directly (no `mise exec` prefix needed).

## Project Coordination

- **GitHub Project is the source of truth.** All work is tracked in the fnrhombus/fntypescript GitHub Project.
- Multiple independent Claude Code sessions may work on this project simultaneously, each running a different agent.
- Use `gh` CLI to interact with issues, PRs, and the project board.

## Agents

- **plan** (Opus) — Technical architect. Discusses direction, writes specs into GitHub issues, breaks features into sub-tasks. Never writes code.
- **research** (Sonnet) — Investigates prior art, docs, and technical questions. Posts findings to issues.
- **code** (Sonnet) — TDD coding agent. Picks up issues with specs, writes tests first, then implementation.
- **qa** (Sonnet) — Reviews PRs against specs, runs tests, validates completeness. Never fixes code, only reports.

## Scope Boundary

**All agents work ONLY on the project's deliverable code** — the contents of `packages/` and `examples/`. The following are explicitly out of scope and must be refused immediately — no exploration, no reading files, no "let me just check":

- Worker pipeline and orchestration scripts (`.claude/run-*.py`, `.claude/run-*`)
- Worktree creation/deletion and orchestration scripts that manage them
- Any tooling that coordinates agents or manages the CI/deploy pipeline
- Anything under `.claude/` that isn't an agent prompt file (`.claude/agents/*.md`)

If the user asks for work on out-of-scope infrastructure, **refuse outright** and explain it's outside this project's domain. Don't start exploring to "understand the request better."
