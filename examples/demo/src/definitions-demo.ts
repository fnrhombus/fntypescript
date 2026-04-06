// The custom-definitions plugin maps handler("name") calls to
// handlers/<name>.ts files. For this demo, you'd need a handlers/
// directory — but even without it, the plugin gracefully does nothing.

declare function handler(name: string): void;

// PLUGIN EFFECT: if handlers/login.ts exists, Ctrl+Click on "login"
// navigates to that file
handler("login");
handler("logout");
