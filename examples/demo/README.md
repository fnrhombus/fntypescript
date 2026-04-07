# fntypescript demo

**Six plugins. Two runtimes. One config.**

This demo shows what fntypescript is actually for: keeping your IDE and your CI in sync when you're running TypeScript compiler plugins.

## The problem

Compiler plugins change the rules — they suppress errors, add completions, rewrite diagnostics. But `tsc --noEmit` doesn't load Language Service plugins. Neither does your bundler. So you get:

- **False red squigglies** in VS Code (the plugin fixes them, but only in the editor)
- **CI failures** (tsc reports errors the plugin would have suppressed)
- **`@ts-expect-error` hacks** scattered through your code to paper over the gap

## The solution

fntypescript runs the same plugin hooks in both runtimes — IDE and build/CI — from the same `compilerOptions.plugins` config:

| Runtime | How | What it does |
|---------|-----|--------------|
| **IDE** | `compilerOptions.plugins` in tsconfig → tsserver loads fntypescript | Plugins run inside the editor. No red squigglies. |
| **CI / build** | `fntypescript check` | Same plugins, same hooks, same results. No false failures. |

> **Note:** `compilerOptions.plugins` ONLY affects the IDE. It has no effect on `tsc` or build tools. That's why `fntypescript check` exists.

## Setup

```json
{
  "compilerOptions": {
    "plugins": [{
      "name": "fntypescript",
      "plugins": [
        "@fntypescript/plugin-function-decorators",
        "@fntypescript/plugin-sql-diagnostics"
      ]
    }]
  }
}
```

Plugins listed in `compilerOptions.plugins[].plugins` are loaded by both runtimes from the same config entry.

## Scripts

```
pnpm run typecheck         # fntypescript check — 0 errors (plugins active)
pnpm run typecheck:vanilla # tsc --noEmit      — reports TS1206 (no plugins)
```

Run both to see the difference. The vanilla script is your proof that the plugins are doing real work.

## Plugins in this demo

| Plugin | Effect | Demo file |
|--------|--------|-----------|
| `plugin-function-decorators` | Suppresses TS1206 so `@decorator` works on standalone functions | `src/decorators-demo.ts` |
| `plugin-sql-diagnostics` | Warns when a `sql\`\`` template doesn't start with a SQL keyword | `src/sql-demo.ts` |
| `plugin-styled-completions` | Offers CSS property completions inside `css\`\`` templates | `src/styled-demo.ts` |
| `plugin-enhanced-hover` | Appends extra docs when hovering over types ending in `Model` | `src/hover-demo.ts` |
| `plugin-custom-definitions` | Maps `handler("name")` calls to `handlers/<name>.ts` for go-to-definition | `src/definitions-demo.ts` |
| `plugin-graphql-diagnostics` | Errors on empty or whitespace-only `gql\`\`` query bodies | `src/graphql-demo.ts` |

## How to verify

1. Run `pnpm run typecheck:vanilla` — you'll see TS1206 errors on the decorated functions in `decorators-demo.ts`. This is what happens without plugins.
2. Run `pnpm run typecheck` — 0 errors. Same code, same tsconfig, plugins active.
3. Open this directory in VS Code with the TypeScript Language Service active. Open `decorators-demo.ts`. No red squigglies on the `@log` and `@memoize` decorators.

## The pattern for real projects

Separate fast compilation from type-checking:

```json
{
  "scripts": {
    "build": "esbuild src/index.ts --bundle --outdir=dist",
    "typecheck": "fntypescript check"
  }
}
```

esbuild (or swc, tsc with `transpileOnly`, etc.) handles emit — it's fast and doesn't care about plugins. `fntypescript check` handles type-checking with your full plugin stack. CI runs both.

## How composition works

Each plugin hooks the same Language Service methods (`getSemanticDiagnostics`, `getCompletionsAtPosition`, etc.). fntypescript chains them via `composeHook` — each plugin receives the prior result and can filter, augment, or replace it. Plugins never know about each other and cannot interfere.
