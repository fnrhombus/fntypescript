# graphql-diagnostics

An fntypescript plugin that reports errors for empty `gql` tagged template literals.

If you write `const query = gql\`\`` (or a template with only whitespace), you get
a clear error in your editor before the query ever reaches your GraphQL client.

## What it demonstrates

- Using the `getSemanticDiagnostics` hook to add custom diagnostics
- Walking the TypeScript AST with `ts.forEachChild` and `ts.isTaggedTemplateExpression`
- Pushing custom `ts.Diagnostic` objects with a stable plugin-owned error code

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
