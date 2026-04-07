import type { HookArgs, HookContext, HookName, HookResult, Plugin, PluginDefinition } from "./types.js";

/** All LanguageService method names that fntypescript hooks into */
export const HOOKABLE_METHODS: readonly HookName[] = [
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

/**
 * Composes a base LanguageService method with plugin hooks.
 *
 * makeContext is called once per plugin per invocation, receiving the plugin name
 * and the fileName extracted from the hook call arguments. Each plugin gets its own
 * logger prefix, config, and correct fileName.
 *
 * Plugins are applied in order; errors are isolated (prior value is kept on throw).
 */
export function composeHook<K extends HookName>(
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
