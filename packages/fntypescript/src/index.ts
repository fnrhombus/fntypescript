import type ts from "typescript/lib/tsserverlibrary";
import { createLanguageServiceProxy } from "./proxy.js";
import { definePlugin } from "./define-plugin.js";
import type { HookableService, HookArgs, HookContext, HookName, HookResult, Plugin, PluginDefinition } from "./types.js";

/** All LanguageService method names that fntypescript hooks into */
const HOOKABLE_METHODS: readonly HookName[] = [
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
function composeHook<K extends HookName>(
  baseMethod: (...args: HookArgs<K>) => HookResult<K>,
  plugins: Plugin[],
  hookName: K,
  makeContext: (pluginName: string, fileName: string) => HookContext,
): (...args: HookArgs<K>) => HookResult<K> {
  const active = plugins.filter(
    (p) => typeof p.definition[hookName] === "function",
  );

  if (active.length === 0) {
    return baseMethod;
  }

  return (...args: HookArgs<K>): HookResult<K> => {
    const fileName = typeof args[0] === "string" ? args[0] : "";

    return active.reduce((prior, plugin) => {
      const ctx = makeContext(plugin.name, fileName);
      const hook = plugin.definition[hookName] as PluginDefinition[K];
      try {
        return (hook as Function)(ctx, prior, ...args) as HookResult<K>;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error(`${hookName} threw: ${message}`);
        return prior;
      }
    }, baseMethod(...args));
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

    const hookable = proxy as HookableService;

    HOOKABLE_METHODS
      .filter((hookName) => typeof hookable[hookName] === "function")
      .forEach((hookName) => {
        const baseMethod = hookable[hookName];
        const makeContext = (pluginName: string, fileName: string): HookContext => ({
          fileName,
          languageService: proxy,
          typescript: _typescript,
          project: info.project,
          config: getPluginConfig(pluginName),
          logger: createPluginLogger(pluginName, serverLogger),
        });

        const composed = composeHook(
          baseMethod.bind(proxy),
          plugins,
          hookName,
          makeContext,
        );

        if (composed !== baseMethod) {
          hookable[hookName] = composed as any;
        }
      });

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
