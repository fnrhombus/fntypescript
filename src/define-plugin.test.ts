import { describe, it, expect } from "vitest";
import { definePlugin } from "./define-plugin.js";
import type { PluginDefinition } from "./types.js";

describe("definePlugin", () => {
  it("returns a Plugin with the given name", () => {
    const plugin = definePlugin({ name: "my-plugin" });
    expect(plugin.name).toBe("my-plugin");
  });

  it("returns a Plugin with the definition attached", () => {
    const def: PluginDefinition = { name: "my-plugin" };
    const plugin = definePlugin(def);
    expect(plugin.definition).toBe(def);
  });

  it("throws when name is an empty string", () => {
    expect(() => definePlugin({ name: "" })).toThrow("definePlugin: 'name' is required");
  });

  it("throws when name is whitespace only", () => {
    expect(() => definePlugin({ name: "   " })).toThrow("definePlugin: 'name' is required");
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  it("throws when definition has no name property", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => definePlugin({} as any)).toThrow("definePlugin: 'name' is required");
  });
});
