import type ts from "typescript/lib/tsserverlibrary";
import { createLanguageServiceProxy } from "./proxy.js";
import { definePlugin } from "./define-plugin.js";
import type { HookContext, Plugin, PluginDefinition } from "./types.js";

/** All LanguageService method names that fntypescript hooks into */
const HOOKABLE_METHODS: ReadonlyArray<keyof PluginDefinition> = [
  "getSemanticDiagnostics",
  "getSyntacticDiagnostics",
  "getSuggestionDiagnostics",
  "getCompletionsAtPosition",
  "getCompletionEntryDetails",
  "getQuickInfoAtPosition",
  "getDefinitionAtPosition",
  "getDefinitionAndBoundSpan",
  "getSignatureHelpItems",
  "getCodeFixesAtPosition",
];

// ts.server.Msg.Err = 2 (numeric enum value; can't use the type import at runtime)
const MSG_ERR = 2 as unknown as Parameters<ts.server.Logger["msg"]>[1];

function createPluginLogger(
  pluginName: string,
  serverLogger: ts.server.Logger,
): HookContext["logger"] {
  return {
    info(message: string): void {
      serverLogger.info(`[fntypescript:${pluginName}] ${message}`);
    },
    error(message: string): void {
      serverLogger.msg(
        `[fntypescript:${pluginName}] ERROR: ${message}`,
        MSG_ERR,
      );
    },
  };
}

/**
 * Composes a base LanguageService method with plugin hooks.
 *
 * makeContext is called once per plugin per invocation, receiving the plugin name,
 * per-plugin config slice, and the fileName extracted from the hook call arguments.
 * This ensures each plugin gets its own logger prefix, config, and correct fileName.
 *
 * Plugins are applied in order; errors are isolated (prior value is kept on throw).
 */
function composeHook<TArgs extends unknown[], TResult>(
  baseMethod: (...args: TArgs) => TResult,
  plugins: Plugin[],
  hookName: keyof PluginDefinition,
  makeContext: (pluginName: string, fileName: string) => HookContext,
): (...args: TArgs) => TResult {
  const active = plugins.filter(
    (p) => typeof p.definition[hookName] === "function",
  );

  if (active.length === 0) {
    return baseMethod;
  }

  return (...args: TArgs): TResult => {
    const fileName = typeof args[0] === "string" ? args[0] : "";
    let result = baseMethod(...args);

    for (const plugin of active) {
      const ctx = makeContext(plugin.name, fileName);
      const hook = plugin.definition[hookName] as unknown as (
        ctx: HookContext,
        prior: TResult,
        ...rest: TArgs
      ) => TResult;
      try {
        result = hook(ctx, result, ...args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error(`${hookName} threw: ${message}`);
      }
    }

    return result;
  };
}

let _typescript: typeof import("typescript/lib/tsserverlibrary");

const _configs = new WeakMap<ts.LanguageService, unknown>();

function init(modules: {
  typescript: typeof import("typescript/lib/tsserverlibrary");
}): ts.server.PluginModule & { getStoredConfig: (proxy: ts.LanguageService) => unknown } {
  _typescript = modules.typescript;

  function create(info: ts.server.PluginCreateInfo, plugins: Plugin[] = []): ts.LanguageService {
    const proxy = createLanguageServiceProxy(info.languageService);
    _configs.set(proxy, info.config);

    if (plugins.length === 0) {
      return proxy;
    }

    const serverLogger = info.project.projectService.logger;

    // Build a lookup from plugin name -> config slice from the tsconfig plugins array
    const rawConfig = (info.config ?? {}) as Record<string, unknown>;
    const pluginsArray = Array.isArray(rawConfig["plugins"])
      ? (rawConfig["plugins"] as Record<string, unknown>[])
      : [];

    function getPluginConfig(pluginName: string): Record<string, unknown> {
      const entry = pluginsArray.find(
        (p) => typeof p === "object" && p !== null && p["name"] === pluginName,
      );
      return (entry as Record<string, unknown> | undefined) ?? {};
    }

    for (const hookName of HOOKABLE_METHODS) {
      const lsKey = hookName as string;
      const baseMethod = (proxy as unknown as Record<string, (...args: unknown[]) => unknown>)[lsKey];

      if (typeof baseMethod !== "function") {
        continue;
      }

      const makeContext = (pluginName: string, fileName: string): HookContext => ({
        fileName,
        languageService: proxy,
        typescript: _typescript,
        project: info.project,
        config: getPluginConfig(pluginName),
        logger: createPluginLogger(pluginName, serverLogger),
      });

      const composed = composeHook(
        baseMethod.bind(proxy) as (...args: unknown[]) => unknown,
        plugins,
        hookName,
        makeContext,
      );

      if (composed !== baseMethod) {
        (proxy as unknown as Record<string, unknown>)[lsKey] = composed;
      }
    }

    return proxy;
  }

  function getExternalFiles(_project: ts.server.Project): string[] {
    return [];
  }

  function getStoredConfig(proxy: ts.LanguageService): unknown {
    return _configs.get(proxy);
  }

  return { create, getExternalFiles, getStoredConfig };
}

// Attach public API as properties so consumers can import them even in CJS contexts
// where `export =` is used.
(init as typeof init & { definePlugin: typeof definePlugin }).definePlugin = definePlugin;

export = init;
