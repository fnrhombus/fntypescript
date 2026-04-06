import { describe, it, expect } from "vitest";
import { definePlugin } from "fntypescript/define-plugin.js";

describe("definePlugin", () => {
  it("returns an object with the given name", () => {
    const plugin = definePlugin({ name: "test" });
    expect(plugin.name).toBe("test");
  });

  it("stores the definition on the returned plugin", () => {
    const def = { name: "test" };
    const plugin = definePlugin(def);
    expect(plugin.definition).toBe(def);
  });

  it("throws when name is missing", () => {
    expect(() => definePlugin({} as { name: string })).toThrowError("name");
  });

  it("throws when name is an empty string", () => {
    expect(() => definePlugin({ name: "" })).toThrowError("name");
  });

  it("throws with the message definePlugin: 'name' is required", () => {
    expect(() => definePlugin({} as { name: string })).toThrowError(
      "definePlugin: 'name' is required"
    );
  });
});
