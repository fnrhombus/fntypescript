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

- `mise exec -- pnpm run build` — build all packages
- `mise exec -- pnpm run test` — build then test
- Core package has NO test dependencies. Tests live in `@fntypescript/tests`.

## Environment

- **Node/pnpm require mise** — `node` and `pnpm` are NOT on the system PATH. Always use `mise exec -- pnpm run test`, `mise exec -- pnpm run build`, etc. A `.mise.toml` is in the project root. Never use bare `npm`, `node`, `pnpm`, or `npx` commands.
- **Python requires mise** — Same for Python: `mise exec python -- python3 ...`

## Project Coordination

- **GitHub Project is the source of truth.** All work is tracked in the fnrhombus/fntypescript GitHub Project.
- Multiple independent Claude Code sessions may work on this project simultaneously, each running a different agent.
- Use `gh` CLI to interact with issues, PRs, and the project board.

## Agents

- **plan** (Opus) — Technical architect. Discusses direction, writes specs into GitHub issues, breaks features into sub-tasks. Never writes code.
- **research** (Sonnet) — Investigates prior art, docs, and technical questions. Posts findings to issues.
- **code** (Sonnet) — TDD coding agent. Picks up issues with specs, writes tests first, then implementation.
- **qa** (Sonnet) — Reviews PRs against specs, runs tests, validates completeness. Never fixes code, only reports.
