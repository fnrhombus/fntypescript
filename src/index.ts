import type ts from "typescript/lib/tsserverlibrary";
import { createLanguageServiceProxy } from "./proxy.js";
import { composeHook } from "./compose.js";
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

    const config = (info.config ?? {}) as Record<string, unknown>;

    for (const hookName of HOOKABLE_METHODS) {
      const lsKey = hookName as string;
      const baseMethod = (proxy as unknown as Record<string, (...args: unknown[]) => unknown>)[lsKey];

      if (typeof baseMethod !== "function") {
        continue;
      }

      const makeContext = (): HookContext => ({
        fileName: "",
        languageService: proxy,
        typescript: _typescript,
        project: info.project,
        config,
        logger: {
          info: (msg) => info.project.projectService.logger.info(msg),
          error: (msg) => info.project.projectService.logger.info(`ERROR: ${msg}`),
        },
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
