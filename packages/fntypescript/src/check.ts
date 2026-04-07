import * as ts from "typescript";
import * as path from "node:path";
import { composeHook, HOOKABLE_METHODS } from "./compose.js";
import { loadSubPlugins } from "./loader.js";
import { createLanguageServiceProxy } from "./proxy.js";
import type { HookContext, HookName, Plugin } from "./types.js";

/** Options for the programmatic check API */
export interface CheckOptions {
  /** Path to tsconfig.json. Defaults to './tsconfig.json' */
  project?: string;
  /** Provide plugins directly — skips reading plugin config from tsconfig */
  plugins?: Plugin[];
}

/** Result returned by the programmatic check API */
export interface CheckResult {
  diagnostics: ts.Diagnostic[];
  exitCode: 0 | 1;
}

/** A LoadedPlugin is a Plugin augmented with its per-instance config */
interface LoadedPlugin extends Plugin {
  readonly config: Record<string, unknown>;
}

const DIAGNOSTIC_HOOK_NAMES = [
  "getSemanticDiagnostics",
  "getSyntacticDiagnostics",
  "getSuggestionDiagnostics",
] as const satisfies readonly HookName[];

function createPluginLogger(pluginName: string): HookContext["logger"] {
  return {
    info: (msg: string) => console.error(`[fntypescript:${pluginName}] ${msg}`),
    error: (msg: string) => console.error(`[fntypescript:${pluginName}] ERROR: ${msg}`),
  };
}

function createLanguageServiceHost(parsed: ts.ParsedCommandLine): ts.LanguageServiceHost {
  const { options, fileNames } = parsed;
  return {
    getCompilationSettings: () => options,
    getScriptFileNames: () => fileNames,
    getScriptVersion: (fileName: string) => {
      const mtime = ts.sys.getModifiedTime?.(fileName);
      return mtime ? String(mtime.getTime()) : "0";
    },
    getScriptSnapshot: (fileName: string) => {
      if (!ts.sys.fileExists(fileName)) return undefined;
      const content = ts.sys.readFile(fileName);
      if (content === undefined) return undefined;
      return ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => ts.sys.getCurrentDirectory(),
    getDefaultLibFileName: (opts: ts.CompilerOptions) => ts.getDefaultLibFilePath(opts),
    fileExists: (f: string) => ts.sys.fileExists(f),
    readFile: (f: string, encoding?: string) => ts.sys.readFile(f, encoding),
    readDirectory: (
      f: string,
      exts?: readonly string[],
      excludes?: readonly string[],
      includes?: readonly string[],
      depth?: number,
    ) => ts.sys.readDirectory(f, exts, excludes, includes, depth),
    directoryExists: (f: string) => ts.sys.directoryExists(f),
    getDirectories: (f: string) => ts.sys.getDirectories(f),
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  };
}

function extractFntypescriptConfig(rawConfig: Record<string, unknown>): Record<string, unknown> {
  const compilerOptions = rawConfig["compilerOptions"];
  if (compilerOptions === null || typeof compilerOptions !== "object") return {};

  const rawPlugins = (compilerOptions as Record<string, unknown>)["plugins"];
  if (!Array.isArray(rawPlugins)) return {};

  const entry = rawPlugins.find(
    (p: unknown) =>
      p !== null &&
      typeof p === "object" &&
      (p as Record<string, unknown>)["name"] === "fntypescript",
  );

  return (entry as Record<string, unknown> | undefined) ?? {};
}

function makeConsoleServerLogger() {
  // Minimal shim satisfying the parts of ts.server.Logger used by loadSubPlugins
  return {
    info: (msg: string) => console.error(msg),
    msg: (msg: string, _type: unknown) => console.error(msg),
    close: () => undefined,
    endGroup: () => undefined,
    getLogFileName: () => undefined,
    getStartTime: () => "",
    hasLevel: () => true,
    loggingEnabled: () => true,
    perftrc: () => undefined,
    startGroup: () => undefined,
  } as unknown as import("typescript/lib/tsserverlibrary").server.Logger;
}

/**
 * Run fntypescript plugin hooks against a TypeScript project, returning all
 * diagnostics after hooks have run. Throws on configuration errors (missing
 * tsconfig, unparseable config). Corresponds to `fntypescript check` on the CLI.
 */
export function check(options?: CheckOptions): CheckResult {
  const projectPath = path.resolve(options?.project ?? "tsconfig.json");
  const configDir = path.dirname(projectPath);

  // ── 1. Read tsconfig ──────────────────────────────────────────────────────
  const configReadResult = ts.readConfigFile(projectPath, ts.sys.readFile);
  if (configReadResult.error) {
    const message = ts.flattenDiagnosticMessageText(configReadResult.error.messageText, "\n");
    throw new Error(`Cannot read tsconfig: ${message}`);
  }

  const rawConfig = configReadResult.config as Record<string, unknown>;

  // ── 2. Parse tsconfig ─────────────────────────────────────────────────────
  const parsed = ts.parseJsonConfigFileContent(rawConfig, ts.sys, configDir);

  // TS error 18002 = "files list is empty" and 18003 = "no inputs found" — both mean empty project, not a real error
  const fatalParseErrors = parsed.errors.filter((e) => e.code !== 18002 && e.code !== 18003);
  if (fatalParseErrors.length > 0) {
    const message = fatalParseErrors
      .map((e) => ts.flattenDiagnosticMessageText(e.messageText, "\n"))
      .join("\n");
    throw new Error(`Cannot parse tsconfig: ${message}`);
  }

  // ── 3. Resolve plugins ────────────────────────────────────────────────────
  let loadedPlugins: LoadedPlugin[];

  if (options?.plugins !== undefined) {
    // Caller supplies plugins directly — wrap each with empty config
    loadedPlugins = options.plugins.map((p) => ({ ...p, config: {} }));
  } else {
    const fnConfig = extractFntypescriptConfig(rawConfig);
    const logger = makeConsoleServerLogger();
    const resolveModule = (moduleName: string): string => {
      if (moduleName.startsWith(".") || moduleName.startsWith("..")) {
        return path.resolve(configDir, moduleName);
      }
      return moduleName;
    };
    loadedPlugins = loadSubPlugins(fnConfig, resolveModule, logger) as LoadedPlugin[];
  }

  // ── 4. Empty project short-circuit ───────────────────────────────────────
  if (parsed.fileNames.length === 0) {
    return { diagnostics: [], exitCode: 0 };
  }

  // ── 5. Create LanguageService ─────────────────────────────────────────────
  const host = createLanguageServiceHost(parsed);
  const baseService = ts.createLanguageService(host) as unknown as import("typescript/lib/tsserverlibrary").LanguageService;
  const proxy = createLanguageServiceProxy(baseService as unknown as ts.LanguageService) as unknown as import("typescript/lib/tsserverlibrary").LanguageService;

  // ── 6. Apply plugin hooks (diagnostic hooks only) ─────────────────────────
  if (loadedPlugins.length > 0) {
    // Build a quick lookup for per-plugin config from the fntypescript plugins array
    const fnPluginsArray = (() => {
      const fnConfig = options?.plugins !== undefined
        ? {}
        : extractFntypescriptConfig(rawConfig);
      const arr = (fnConfig as Record<string, unknown>)["plugins"];
      return Array.isArray(arr) ? (arr as Record<string, unknown>[]) : [];
    })();

    const getPluginConfig = (pluginName: string): Record<string, unknown> => {
      if (options?.plugins !== undefined) return {};
      const entry = fnPluginsArray.find(
        (p) => typeof p === "object" && p !== null && p["name"] === pluginName,
      );
      return (entry as Record<string, unknown> | undefined) ?? {};
    };

    const makeContext = (pluginName: string, fileName: string): HookContext => ({
      fileName,
      languageService: proxy as unknown as import("typescript/lib/tsserverlibrary").LanguageService,
      typescript: ts as unknown as typeof import("typescript/lib/tsserverlibrary"),
      config: getPluginConfig(pluginName),
      logger: createPluginLogger(pluginName),
    });

    for (const hookName of DIAGNOSTIC_HOOK_NAMES) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const hookable = proxy as unknown as Record<string, any>;
      if (typeof hookable[hookName] !== "function") continue;

      const baseMethod = hookable[hookName].bind(proxy) as (...args: unknown[]) => unknown;

      // composeHook is generic — we bypass the union-type narrowing issue by casting to any
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const composed = (composeHook as any)(baseMethod, loadedPlugins, hookName, makeContext);

      if (composed !== baseMethod) {
        hookable[hookName] = composed;
      }
    }
  }

  // ── 7. Collect diagnostics for all source files ───────────────────────────
  const allDiagnostics: ts.Diagnostic[] = [];
  const typedProxy = proxy as unknown as ts.LanguageService;

  for (const fileName of parsed.fileNames) {
    allDiagnostics.push(...typedProxy.getSyntacticDiagnostics(fileName));
    allDiagnostics.push(...typedProxy.getSemanticDiagnostics(fileName));
    allDiagnostics.push(...typedProxy.getSuggestionDiagnostics(fileName));
  }

  const hasErrors = allDiagnostics.some((d) => d.category === ts.DiagnosticCategory.Error);
  return { diagnostics: allDiagnostics, exitCode: hasErrors ? 1 : 0 };
}
