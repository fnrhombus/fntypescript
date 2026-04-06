import type ts from "typescript/lib/tsserverlibrary";
import type { Plugin } from "./types.js";

// `require` is available at runtime (TS server runs in CJS Node); declare it for tsc.
declare const require: (id: string) => unknown;

/** A loaded plugin with its per-instance config attached. */
export interface LoadedPlugin extends Plugin {
  readonly config: Record<string, unknown>;
}

function isValidPlugin(value: unknown): value is Plugin {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as Record<string, unknown>)["name"] === "string" &&
    typeof (value as Record<string, unknown>)["definition"] === "object" &&
    (value as Record<string, unknown>)["definition"] !== null
  );
}

/**
 * Resolves and loads sub-plugins declared in `config.plugins`.
 *
 * @param config - The raw tsconfig plugin config block.
 * @param resolveModule - Callback that resolves a module name to an absolute path.
 * @param logger - TypeScript server logger for diagnostics.
 * @param requireFn - Module loader (defaults to `require`). Injectable for testing.
 */
export function loadSubPlugins(
  config: Record<string, unknown>,
  resolveModule: (moduleName: string) => string,
  logger: ts.server.Logger,
  requireFn: (id: string) => unknown = require,
): LoadedPlugin[] {
  const rawPlugins = config["plugins"];

  if (rawPlugins === undefined) {
    return [];
  }

  if (!Array.isArray(rawPlugins)) {
    logger.info("fntypescript: 'plugins' config must be an array");
    return [];
  }

  const results: LoadedPlugin[] = [];

  for (const entry of rawPlugins as unknown[]) {
    let moduleName: string;
    let pluginConfig: Record<string, unknown>;

    if (typeof entry === "string") {
      moduleName = entry;
      pluginConfig = {};
    } else if (
      entry !== null &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>)["name"] === "string"
    ) {
      moduleName = (entry as Record<string, unknown>)["name"] as string;
      pluginConfig = entry as Record<string, unknown>;
    } else {
      logger.info(
        `fntypescript: Invalid plugin entry in config (expected string or object with 'name')`,
      );
      continue;
    }

    let loaded: unknown;
    try {
      const resolvedPath = resolveModule(moduleName);
      loaded = requireFn(resolvedPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.info(`fntypescript: Failed to load plugin '${moduleName}': ${message}`);
      continue;
    }

    // ESM interop: if the module has a `.default` that is a valid Plugin, use it
    if (
      !isValidPlugin(loaded) &&
      loaded !== null &&
      typeof loaded === "object" &&
      isValidPlugin((loaded as Record<string, unknown>)["default"])
    ) {
      loaded = (loaded as Record<string, unknown>)["default"];
    }

    if (!isValidPlugin(loaded)) {
      logger.info(
        `fntypescript: Module '${moduleName}' does not export a valid fntypescript plugin. Did you forget to use definePlugin()?`,
      );
      continue;
    }

    results.push({ ...loaded, config: pluginConfig });
  }

  return results;
}
