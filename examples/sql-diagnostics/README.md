# sql-diagnostics

A fntypescript plugin that validates `sql` tagged template literals at edit time. It reports a warning whenever the query text does not begin with a recognised SQL keyword (SELECT, INSERT, UPDATE, DELETE, etc.), catching typos and malformed queries before they reach the database.

Inspired by the query validation features in libraries like `postgres` (porsager), `slonik`, and `kysely`, which surface SQL errors at runtime. This plugin surfaces them earlier — in your editor.

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
