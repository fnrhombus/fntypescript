# custom-definitions

An fntypescript plugin that adds go-to-definition support for string arguments
in `handler("...")` calls. When the cursor is on the string, the editor
navigates to `handlers/<name>.ts` relative to the current file — if it exists.

This pattern mirrors how tRPC, fastify, and similar frameworks map string
route/handler names to files on disk.

## What it demonstrates

- Using the `getDefinitionAndBoundSpan` hook to inject custom `DefinitionInfo`
- Walking the AST to find a specific call pattern and extract a string argument
- Using `fs.existsSync` to conditionally add definitions only for real files

## Setup

Add to your `tsconfig.json`:

```json
{
  "compilerOptions": {
    "plugins": [{ "name": "fntypescript" }]
  }
}
```

Then register this plugin via fntypescript's plugin registry (see the main docs).
