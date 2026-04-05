import type { Plugin, PluginDefinition } from "./types.js";

export function definePlugin(definition: PluginDefinition): Plugin {
  if (!definition || typeof definition.name !== "string" || definition.name.trim() === "") {
    throw new Error("definePlugin: 'name' is required");
  }
  return { name: definition.name, definition };
}
