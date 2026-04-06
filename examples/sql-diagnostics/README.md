# sql-diagnostics

An fntypescript plugin that warns when a `sql` tagged template literal doesn't
begin with a recognized SQL keyword (SELECT, INSERT, UPDATE, DELETE, CREATE,
DROP, ALTER).

Catches copy-paste errors and misplaced strings before they hit the database.

## What it demonstrates

- Using the `getSemanticDiagnostics` hook to add `DiagnosticCategory.Warning`
- Extracting the first word from a template literal's text content
- Emitting warnings rather than errors for non-blocking policy enforcement

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
