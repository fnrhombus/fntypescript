import type ts from "typescript/lib/tsserverlibrary";
import type { HookContext, Plugin, PluginDefinition } from "./types.js";

export function createPluginLogger(
  pluginName: string,
  serverLogger: ts.server.Logger,
): HookContext["logger"] {
  return {
    info(message: string) {
      serverLogger.info(`[fntypescript:${pluginName}] ${message}`);
    },
    error(message: string) {
      serverLogger.msg(
        `[fntypescript:${pluginName}] ERROR: ${message}`,
        "Err" as ts.server.Msg,
      );
    },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function composeHook<TArgs extends any[], TResult>(
  baseMethod: (...args: TArgs) => TResult,
  plugins: Plugin[],
  hookName: keyof PluginDefinition,
  makeContext: (args: TArgs) => HookContext,
): (...args: TArgs) => TResult {
  const activePlugins = plugins.filter(
    (p) => typeof p.definition[hookName] === "function",
  );

  if (activePlugins.length === 0) {
    return baseMethod;
  }

  return function (...args: TArgs): TResult {
    const ctx = makeContext(args);
    let prior = baseMethod(...args);

    for (const plugin of activePlugins) {
      const hook = plugin.definition[hookName] as unknown as (
        ctx: HookContext,
        prior: TResult,
        ...args: TArgs
      ) => TResult;
      try {
        prior = hook(ctx, prior, ...args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error(message);
      }
    }

    return prior;
  };
}
