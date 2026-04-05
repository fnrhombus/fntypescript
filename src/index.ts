import type ts from "typescript/lib/tsserverlibrary";
import { createLanguageServiceProxy } from "./proxy.js";

function init(modules: {
  typescript: typeof import("typescript/lib/tsserverlibrary");
}): ts.server.PluginModule {
  void modules;

  function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    void info.config;
    return createLanguageServiceProxy(info.languageService);
  }

  function getExternalFiles(_project: ts.server.Project): string[] {
    return [];
  }

  return { create, getExternalFiles };
}

export = init;
