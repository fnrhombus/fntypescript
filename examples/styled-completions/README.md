# styled-completions

A fntypescript plugin that provides CSS property name completions when your cursor is inside a `css` tagged template literal. The suggestions are merged with any completions TypeScript already provides, so you get the best of both worlds.

Inspired by the editor intelligence built into styled-components and Emotion's VS Code extensions, but implemented as a Language Service plugin that works in any tsserver-powered editor without requiring a dedicated extension.

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
