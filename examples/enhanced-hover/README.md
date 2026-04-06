# enhanced-hover

An fntypescript plugin that augments hover documentation for any symbol whose
display text contains "Model". It appends a note pointing users toward
framework model docs without discarding the existing hover information.

This pattern is useful for ORM-style libraries (Prisma, TypeORM) where generated
model types benefit from contextual documentation in the editor.

## What it demonstrates

- Using the `getQuickInfoAtPosition` hook to augment (not replace) hover info
- Inspecting `prior.displayParts` to decide whether to act
- Appending to `prior.documentation` while preserving all existing data

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
