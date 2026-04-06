# custom-definitions

A fntypescript plugin that augments go-to-definition for `handler("name")` call expressions. When your cursor is on the string argument, pressing "Go to Definition" will navigate to `handlers/<name>.ts` relative to the current file — in addition to any definitions TypeScript already knows about.

Inspired by the navigation experience in tRPC and Hono, where route and handler names are string-typed and editors can't natively jump to their implementations. This plugin shows how to teach TypeScript's Language Service about those implicit file-based conventions.

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
