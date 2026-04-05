import type ts from "typescript/lib/tsserverlibrary";
import { createLanguageServiceProxy } from "./proxy.js";

let _typescript: typeof import("typescript/lib/tsserverlibrary");

const _configs = new WeakMap<ts.LanguageService, unknown>();

function init(modules: {
  typescript: typeof import("typescript/lib/tsserverlibrary");
}): ts.server.PluginModule & { getStoredConfig: (proxy: ts.LanguageService) => unknown } {
  _typescript = modules.typescript;

  function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    const proxy = createLanguageServiceProxy(info.languageService);
    _configs.set(proxy, info.config);
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

export = init;
