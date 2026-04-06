# graphql-diagnostics

An fntypescript plugin that reports errors for empty `gql` tagged template literals.

If you write `const query = gql\`\`` (or a template with only whitespace), you get
a clear error in your editor before the query ever reaches your GraphQL client.

## What it demonstrates

- Using the `getSemanticDiagnostics` hook to add custom diagnostics
- Walking the TypeScript AST with `ts.forEachChild` and `ts.isTaggedTemplateExpression`
- Pushing custom `ts.Diagnostic` objects with a stable plugin-owned error code

## Setup

Register this plugin in your fntypescript configuration. See the [demo project](../demo/) for a complete multi-plugin example.
