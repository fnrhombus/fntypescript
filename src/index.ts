import type ts from "typescript/lib/tsserverlibrary";
import { createLanguageServiceProxy } from "./proxy.js";
import { composeHook, createPluginLogger } from "./compose.js";
import { definePlugin as _definePlugin } from "./define-plugin.js";
import type { HookContext, Plugin, PluginDefinition } from "./types.js";

let _typescript: typeof import("typescript/lib/tsserverlibrary");

const _configs = new WeakMap<ts.LanguageService, unknown>();

const HOOKABLE_METHODS = [
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
] as const;

type HookableName = (typeof HOOKABLE_METHODS)[number];

function init(modules: {
  typescript: typeof import("typescript/lib/tsserverlibrary");
}): ts.server.PluginModule & { getStoredConfig: (proxy: ts.LanguageService) => unknown } {
  _typescript = modules.typescript;

  function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    const proxy = createLanguageServiceProxy(info.languageService);
    _configs.set(proxy, info.config);

    const pluginConfigs = info.config as Record<string, unknown>;
    const plugins: Plugin[] = Array.isArray(pluginConfigs["plugins"])
      ? (pluginConfigs["plugins"] as Plugin[])
      : [];

    if (plugins.length === 0) {
      return proxy;
    }

    function makeContext(pluginName: string, args: unknown[]): HookContext {
      return {
        fileName: args[0] as string,
        languageService: proxy,
        typescript: _typescript,
        project: info.project,
        config: pluginConfigs,
        logger: createPluginLogger(
          pluginName,
          info.project.projectService.logger,
          _typescript
        ),
      };
    }

    for (const methodName of HOOKABLE_METHODS) {
      const hasHook = plugins.some(
        (p) => typeof (p.definition as unknown as Record<string, unknown>)[methodName] === "function"
      );
      if (hasHook) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (proxy as any)[methodName] = composeHook(
          plugins,
          methodName as HookableName,
          makeContext,
          proxy
        );
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

init.definePlugin = _definePlugin;

export = init;

// Re-export types via namespace merging for consumers using `import type`
declare namespace init {
  export type { HookContext, PluginDefinition, Plugin };
}
