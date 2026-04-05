import type ts from "typescript/lib/tsserverlibrary";
import type { HookContext, Plugin, PluginDefinition } from "./types.js";

// ts.server.Msg.Err = 2 (numeric enum value; can't use the type import at runtime)
const MSG_ERR = 2 as unknown as Parameters<ts.server.Logger["msg"]>[1];

export function createPluginLogger(
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
 * Each plugin hook receives (ctx, prior, ...originalArgs) and returns the new result.
 * Plugins are applied in order; errors are isolated (prior value is kept on throw).
 */
export function composeHook<TArgs extends unknown[], TResult>(
  baseMethod: (...args: TArgs) => TResult,
  plugins: Plugin[],
  hookName: keyof PluginDefinition,
  makeContext: () => HookContext,
): (...args: TArgs) => TResult {
  const active = plugins.filter(
    (p) => typeof p.definition[hookName] === "function",
  );

  if (active.length === 0) {
    return baseMethod;
  }

  return (...args: TArgs): TResult => {
    const ctx = makeContext();
    let result = baseMethod(...args);

    for (const plugin of active) {
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
