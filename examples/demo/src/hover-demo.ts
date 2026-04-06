// PLUGIN EFFECT: hover over UserModel to see the appended documentation
// about framework model types. The "enhanced-hover" plugin recognizes
// types ending in "Model" and appends extra info.

interface UserModel {
  id: number;
  name: string;
  email: string;
}

const user: UserModel = { id: 1, name: "Alice", email: "alice@example.com" };

// Hovering over a non-Model type shows normal hover — no plugin additions
interface Config {
  debug: boolean;
}

export { user };
export type { UserModel, Config };
