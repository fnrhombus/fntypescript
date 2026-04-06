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

Register this plugin in your fntypescript configuration. See the [demo project](../demo/) for a complete multi-plugin example.
