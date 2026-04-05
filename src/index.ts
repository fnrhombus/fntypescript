import type ts from "typescript";
import { createLanguageServiceProxy } from "./proxy.js";

function init(_modules: { typescript: typeof ts }) {
  let _config: unknown;

  function create(info: ts.server.PluginCreateInfo): ts.LanguageService {
    _config = info.config;
    return createLanguageServiceProxy(info.languageService);
  }

  function getExternalFiles(): string[] {
    return [];
  }

  return { create, getExternalFiles };
}

export = init;
