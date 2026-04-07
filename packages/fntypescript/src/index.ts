import type ts from "typescript/lib/tsserverlibrary";
import { createLanguageServiceProxy } from "./proxy.js";
import { definePlugin } from "./define-plugin.js";
import { loadSubPlugins } from "./loader.js";
import { composeHook, HOOKABLE_METHODS } from "./compose.js";
import type { HookableService, HookContext, HookName, Plugin } from "./types.js";

// `require` is available at runtime (TS server runs in CJS Node); declare it for tsc.
declare const require: (id: string) => unknown;

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

let _typescript: typeof import("typescript/lib/tsserverlibrary");

const _configs = new WeakMap<ts.LanguageService, unknown>();

function init(modules: {
  typescript: typeof import("typescript/lib/tsserverlibrary");
}): ts.server.PluginModule & { getStoredConfig: (proxy: ts.LanguageService) => unknown } {
  _typescript = modules.typescript;

  function create(info: ts.server.PluginCreateInfo, plugins?: Plugin[]): ts.LanguageService {
    const proxy = createLanguageServiceProxy(info.languageService);
    _configs.set(proxy, info.config);

    const rawConfig = (info.config ?? {}) as Record<string, unknown>;

    let resolvedPlugins: Plugin[];
    if (plugins !== undefined) {
      resolvedPlugins = plugins;
    } else {
      // Only access project services when there are plugins to load
      const rawPlugins = rawConfig["plugins"];
      if (rawPlugins === undefined || (Array.isArray(rawPlugins) && rawPlugins.length === 0)) {
        resolvedPlugins = [];
      } else {
        const serverLogger = info.project.projectService.logger;
        const projectDir = info.project.getCurrentDirectory();
        const resolveModule = (moduleName: string): string => {
          if (moduleName.startsWith(".") || moduleName.startsWith("..")) {
            const pathModule = require("path") as { resolve: (...args: string[]) => string };
          return pathModule.resolve(projectDir, moduleName);
          }
          return moduleName;
        };
        resolvedPlugins = loadSubPlugins(rawConfig, resolveModule, serverLogger, require as (id: string) => unknown);
      }
    }

    if (resolvedPlugins.length === 0) {
      return proxy;
    }

    const serverLogger = info.project.projectService.logger;

    // Build a lookup from plugin name -> config slice from the tsconfig plugins array
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
          resolvedPlugins,
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

// Attach definePlugin as a property on init so it is accessible at runtime.
// The namespace declaration below merges with the function declaration so that
// `import { definePlugin } from 'fntypescript'` resolves at the type level.
(init as typeof init & { definePlugin: typeof definePlugin }).definePlugin = definePlugin;

namespace init {
  export declare const definePlugin: typeof import("./define-plugin.js").definePlugin;
}

export = init;
