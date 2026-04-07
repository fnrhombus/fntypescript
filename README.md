# fntypescript

A TypeScript Language Service plugin framework.

A general-purpose framework for extending TypeScript editor intelligence. Provides stable extension points so library/framework authors can add custom diagnostics, completions, quick info, go-to-definition, and more — without writing boilerplate proxy code or worrying about TypeScript version churn.

## Setup

**Install:**
```
npm install fntypescript
```

**Configure `tsconfig.json`:**
```json
{
  "compilerOptions": {
    "plugins": [
      {
        "name": "fntypescript",
        "plugins": [
          { "name": "my-fntypescript-plugin" }
        ]
      }
    ]
  }
}
```

**Create a sub-plugin:**
```ts
import { definePlugin } from "fntypescript/define-plugin.js";

export default definePlugin({
  name: "my-plugin",
  getCompletionsAtPosition(ctx, prior, fileName, position, options) {
    // ctx.typescript — the TypeScript module
    // ctx.logger    — info/error logging
    // ctx.config    — plugin config from tsconfig.json
    return prior;
  },
});
```

## Available hooks

| Hook | Description |
|------|-------------|
| `getSemanticDiagnostics` | Type errors and semantic issues |
| `getSyntacticDiagnostics` | Parse-level errors |
| `getSuggestionDiagnostics` | Editor hints and suggestions |
| `getCompletionsAtPosition` | Completion list |
| `getCompletionEntryDetails` | Completion item details |
| `getQuickInfoAtPosition` | Hover info |
| `getDefinitionAtPosition` | Go-to-definition |
| `getDefinitionAndBoundSpan` | Go-to-definition with highlight span |
| `getSignatureHelpItems` | Signature help / parameter info |
| `getCodeFixesAtPosition` | Quick fixes and code actions |

Every hook receives `(ctx, prior, ...originalArgs)` — the context object, the result from the previous handler (or the built-in TypeScript result), then the original Language Service arguments.

## Examples

See [`examples/`](./examples/) for working plugins demonstrating diagnostics, completions, hover, and more.

## License

MIT
