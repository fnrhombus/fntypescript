# fntypescript

A general-purpose TypeScript Language Service plugin framework — stable extension points for TS tooling authors.

## Working Guidelines

- **Token efficiency is mandatory** — Always operate as token-efficient as absolutely possible without sacrificing result quality.
- **No guessing** — If you don't know what to do, or encounter an error you don't immediately understand, do a brief web search before trying anything. Only after research may you begin experimenting.
- **No speculative creation** — Never create files, features, or structures you aren't sure about. If there's any uncertainty about what to make, ask the user first.

## Environment

- **Node/npm require mise** — `node` and `npm` are NOT on the system PATH. Always use `mise exec node -- npm test`, `mise exec node -- npx vitest run`, etc. A `.mise.toml` is in the project root. Never use bare `npm`, `node`, or `npx` commands.
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
