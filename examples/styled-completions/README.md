# styled-completions

An fntypescript plugin that injects CSS property completions inside `css` tagged
template literals (as used by styled-components, Emotion, and similar libraries).

When the cursor is inside a `css\`...\`` expression, the editor offers completions
for `display`, `color`, `margin`, `padding`, `font-size`, `background`, `border`,
`width`, `height`, and `position` alongside any standard TypeScript completions.

## What it demonstrates

- Using the `getCompletionsAtPosition` hook to merge custom completion entries
- Detecting cursor position relative to an AST node's span
- Building `ts.CompletionEntry` objects and returning a well-formed completion list

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
