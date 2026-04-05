import { describe, it, expect } from "vitest";
import { definePlugin } from "./define-plugin.js";

describe("definePlugin", () => {
  it("returns a Plugin object with the given name", () => {
    const plugin = definePlugin({ name: "my-plugin" });

    expect(plugin.name).toBe("my-plugin");
  });

  it("returns a Plugin object with the definition attached", () => {
    const definition = { name: "my-plugin" };
    const plugin = definePlugin(definition);

    expect(plugin.definition).toBe(definition);
  });

  it("throws when name is missing", () => {
    expect(() => definePlugin({ name: "" })).toThrow("definePlugin: 'name' is required");
  });

  it("throws when name is not a string", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => definePlugin({ name: null as any })).toThrow("definePlugin: 'name' is required");
  });

  it("returns a frozen Plugin object", () => {
    const plugin = definePlugin({ name: "frozen-plugin" });

    expect(Object.isFrozen(plugin)).toBe(true);
  });
});
