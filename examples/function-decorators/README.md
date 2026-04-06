# Function Decorators Example

Decorators on standalone function declarations — something TypeScript's parser supports but the compiler forbids. This example shows how to use **fntypescript** (Language Service plugin) and **ts-patch** (compiler transformer) together to fully unlock this feature.

## What it does

```typescript
@log
function greet(name: string) {
  return `Hello, ${name}!`;
}
```

Without the plugin, TypeScript shows **TS1206: "Decorators are not valid here."** and refuses to compile.

With the plugin:
- Your editor shows **no errors** (Language Service plugin suppresses TS1206)
- `tspc` compiles it to working JavaScript (transformer rewrites the AST):

```javascript
function greet(name) { return `Hello, ${name}!`; }
greet = log(greet);
```

## Setup

Register this plugin in your fntypescript configuration. See the [demo project](../demo/) for a complete multi-plugin example.

## How it works

TypeScript's parser already recognizes `@decorator function foo() {}` and attaches the decorator to the `FunctionDeclaration` node's modifier list. The AST is structurally valid. The error is purely semantic — the type checker says "you can't put that there."

The plugin suppresses that one diagnostic in two places:

| Layer | Tool | What it does |
|-------|------|-------------|
| Editor | fntypescript | Filters TS1206 from `getSemanticDiagnostics` and `getSyntacticDiagnostics` |
| Compiler | ts-patch | Calls `removeDiagnostic()` to suppress TS1206, then transforms `@d function f() {}` into `function f() {} f = d(f);` |

## Limitations

- **No type narrowing** — TypeScript doesn't know the decorator changed the function's type. If `@log` changes the return type, TS won't see it. The function's type signature in the editor remains the original.
- **Stacked decorators** are applied inside-out (closest to the function first), matching TC39 class decorator semantics.
- **`export` + decorator** — works, but the export gets the original type, not the decorated one.
