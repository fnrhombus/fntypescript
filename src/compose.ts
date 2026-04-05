import type ts from "typescript/lib/tsserverlibrary";
import type { HookContext, Plugin, PluginDefinition } from "./types.js";

export function createPluginLogger(
  pluginName: string,
  logger: ts.server.Logger,
  typescript: typeof ts
): HookContext["logger"] {
  void typescript;
  return {
    info(message: string): void {
      logger.info(`[${pluginName}] ${message}`);
    },
    error(message: string): void {
      logger.msg(`[${pluginName}] ${message}`, typescript.server.Msg.Err);
    },
  };
}

type HookName = keyof PluginDefinition & keyof ts.LanguageService;

export function composeHook<TArgs extends unknown[], TResult>(
  plugins: Plugin[],
  hookName: HookName,
  makeContext: (pluginName: string, args: TArgs) => HookContext,
  proxy: ts.LanguageService
): (...args: TArgs) => TResult {
  return function (...args: TArgs): TResult {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const baseMethod = (proxy as any)[hookName] as (...a: TArgs) => TResult;
    let result: TResult = baseMethod(...args);

    for (const plugin of plugins) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hook = (plugin.definition as any)[hookName] as
        | ((ctx: HookContext, prior: TResult, ...a: TArgs) => TResult)
        | undefined;

      if (typeof hook !== "function") {
        continue;
      }

      const ctx = makeContext(plugin.name, args);
      try {
        result = hook(ctx, result, ...args);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error(`Hook '${hookName}' threw: ${message}`);
      }
    }

    return result;
  };
}
