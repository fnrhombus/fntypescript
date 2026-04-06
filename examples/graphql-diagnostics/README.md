# graphql-diagnostics

A fntypescript plugin that validates `gql` tagged template literals at edit time. It reports an error diagnostic whenever a `gql` template is empty or contains only whitespace — a common mistake when scaffolding GraphQL queries with libraries like `graphql-tag` or `@apollo/client`.

Inspired by the editor experience provided by the official GraphQL VS Code extension, but implemented as a Language Service plugin so it works in any editor that supports tsserver (VS Code, Neovim, WebStorm, etc.) without a separate LSP server.

## Setup

```json
// tsconfig.json
{
  "compilerOptions": {
    "plugins": [
      { "name": "fntypescript" }
    ]
  }
}
```

Register the plugin in your tsserver plugin config so it's loaded alongside the core fntypescript plugin.
