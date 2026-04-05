import type ts from "typescript/lib/tsserverlibrary";
import type { Plugin } from "./types.js";

function isPlugin(value: unknown): value is Plugin {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["name"] === "string" &&
    typeof (value as Record<string, unknown>)["definition"] === "object" &&
    (value as Record<string, unknown>)["definition"] !== null
  );
}

/**
 * Resolves and loads sub-plugins listed in the fntypescript config.
 *
 * @param config - The raw tsconfig plugin config object.
 * @param resolveModule - Callback that resolves a module name to an absolute path.
 * @param logger - The TypeScript server logger for diagnostic messages.
 * @param requireFn - Injectable require function (defaults to Node's require; testable via injection).
 */
export function loadSubPlugins(
  config: Record<string, unknown>,
  resolveModule: (moduleName: string) => string,
  logger: ts.server.Logger,
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  requireFn: (id: string) => unknown = require,
): Plugin[] {
  const rawPlugins = config["plugins"];

  if (rawPlugins === undefined) {
    return [];
  }

  if (!Array.isArray(rawPlugins)) {
    logger.info("fntypescript: 'plugins' config must be an array");
    return [];
  }

  const results: Plugin[] = [];

  for (const entry of rawPlugins as unknown[]) {
    let moduleName: string;

    if (typeof entry === "string") {
      moduleName = entry;
    } else if (
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as Record<string, unknown>)["name"] === "string"
    ) {
      moduleName = (entry as Record<string, unknown>)["name"] as string;
    } else {
      logger.info(
        "fntypescript: 'plugins' config must be an array",
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

    // CJS/ESM interop: if the module exports a `default`, use it
    if (
      typeof loaded === "object" &&
      loaded !== null &&
      "default" in loaded &&
      loaded["default"] !== undefined
    ) {
      loaded = (loaded as Record<string, unknown>)["default"];
    }

    if (!isPlugin(loaded)) {
      logger.info(
        `fntypescript: Module '${moduleName}' does not export a valid fntypescript plugin. Did you forget to use definePlugin()?`,
      );
      continue;
    }

    results.push(loaded);
  }

  return results;
}
