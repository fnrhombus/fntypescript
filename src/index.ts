import type ts from "typescript/lib/tsserverlibrary";
import { createLanguageServiceProxy } from "./proxy.js";
import { composeHook, createPluginLogger } from "./compose.js";
import type { Plugin, PluginDefinition } from "./types.js";

export type { HookContext, PluginDefinition, Plugin } from "./types.js";
export { definePlugin } from "./define-plugin.js";

let _typescript: typeof import("typescript/lib/tsserverlibrary");

const _configs = new WeakMap<ts.LanguageService, unknown>();

const COMPOSABLE_HOOKS: ReadonlyArray<keyof PluginDefinition> = [
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

function init(
  modules: { typescript: typeof import("typescript/lib/tsserverlibrary") },
  plugins: Plugin[] = [],
): ts.server.PluginModule & { getStoredConfig: (proxy: ts.LanguageService) => unknown } {
  _typescript = modules.typescript;

  function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    const proxy = createLanguageServiceProxy(info.languageService);
    _configs.set(proxy, info.config);

    const config = info.config as Record<string, unknown>;

    for (const hookName of COMPOSABLE_HOOKS) {
      const baseMethod = info.languageService[hookName as keyof ts.LanguageService];
      if (typeof baseMethod !== "function") continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bound = (baseMethod as (...args: any[]) => any).bind(info.languageService);
      const composed = composeHook(
        bound,
        plugins,
        hookName,
        () => ({
          fileName: "",
          languageService: info.languageService,
          typescript: _typescript,
          project: info.project,
          config,
          logger: createPluginLogger("fntypescript", info.project.projectService.logger),
        }),
      );

      if (composed !== bound) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (proxy as any)[hookName] = composed;
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

export default init;
