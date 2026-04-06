# enhanced-hover

A fntypescript plugin that augments the QuickInfo (hover tooltip) for any symbol whose type name contains "Model". It appends a documentation note reminding developers to check their schema definition for field constraints and relations.

Inspired by the rich hover experience provided by the Prisma VS Code extension, which injects schema context into editor tooltips. This plugin shows how that pattern can be implemented as a lightweight Language Service plugin — no language server required.

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
