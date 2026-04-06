# fntypescript demo

**Six plugins, one tsconfig, zero conflicts.**

This project exercises every example plugin in the fntypescript ecosystem — all running simultaneously in a single TypeScript Language Service instance.

## Setup

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "fntypescript" }]
  }
}
```

That's it. fntypescript loads all registered plugins automatically.

## Plugins in this demo

| Plugin | Effect | Demo file |
|--------|--------|-----------|
| `plugin-function-decorators` | Suppresses TS1206 so `@decorator` works on standalone functions | `src/decorators-demo.ts` |
| `plugin-sql-diagnostics` | Warns when a `sql\`\`` template doesn't start with a SQL keyword | `src/sql-demo.ts` |
| `plugin-styled-completions` | Offers CSS property completions inside `css\`\`` templates | `src/styled-demo.ts` |
| `plugin-enhanced-hover` | Appends extra docs when hovering over types ending in `Model` | `src/hover-demo.ts` |
| `plugin-custom-definitions` | Maps `handler("name")` calls to `handlers/<name>.ts` for go-to-definition | `src/definitions-demo.ts` |
| `plugin-graphql-diagnostics` | Errors on empty or whitespace-only `gql\`\`` query bodies | `src/graphql-demo.ts` |

## How composition works

Each plugin is defined with `definePlugin()` and hooks the same Language Service methods (`getSemanticDiagnostics`, `getCompletionsAtPosition`, `getQuickInfoAtPosition`, etc.). fntypescript chains them via `composeHook` — each plugin receives the prior result and can filter, augment, or replace it. Plugins never know about each other and cannot interfere.

## Try it

1. Open this directory in VS Code with the TypeScript Language Service active.
2. Open any demo file.
3. Look for the `// PLUGIN EFFECT:` comments — they describe exactly what to expect.
4. For completions (styled-demo), press `Ctrl+Space` inside a `css\`\`` template.
5. For hover (hover-demo), hover over `UserModel` vs `Config` to see the difference.
