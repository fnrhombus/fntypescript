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

Register this plugin in your fntypescript configuration. See the [demo project](../demo/) for a complete multi-plugin example.
