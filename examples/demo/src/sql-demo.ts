// PLUGIN EFFECT: the "sql-diagnostics" plugin validates sql`` tagged templates
// in real time, warning when the query doesn't start with a recognized SQL keyword.

declare function sql(strings: TemplateStringsArray, ...values: unknown[]): string;

// VALID: starts with a SQL keyword — no warning
const users = sql`SELECT * FROM users WHERE id = ${1}`;

// PLUGIN EFFECT: "sql-diagnostics" plugin shows a warning here
// because "GRAB" is not a recognized SQL keyword
const bad = sql`GRAB everything FROM nowhere`;

// PLUGIN EFFECT: empty query body — also warned
const empty = sql`   `;

export { users, bad, empty };
