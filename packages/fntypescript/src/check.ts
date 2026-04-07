import ts from "typescript";
import * as path from "path";
import { loadSubPlugins } from "./loader.js";
import { composeHook } from "./compose.js";
import type { HookContext, Plugin } from "./types.js";

// `require` is available at runtime (compiled to CJS Node); declare it for tsc.
declare const require: (id: string) => unknown;

export interface CheckOptions {
  /** Path to tsconfig.json. Defaults to './tsconfig.json' resolved from cwd. */
  project?: string;
  /** Override plugin list (skip reading from tsconfig). */
  plugins?: Plugin[];
}

export interface CheckResult {
  diagnostics: ts.Diagnostic[];
  exitCode: 0 | 1;
}

function createLanguageServiceHost(
  compilerOptions: ts.CompilerOptions,
  fileNames: string[],
  projectDir: string,
): ts.LanguageServiceHost {
  return {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => fileNames,
    getScriptVersion: (fileName: string) => {
      try {
        return ts.sys.getModifiedTime?.(fileName)?.getTime().toString() ?? "0";
      } catch {
        return "0";
      }
    },
    getScriptSnapshot: (fileName: string) => {
      if (!ts.sys.fileExists(fileName)) return undefined;
      const content = ts.sys.readFile(fileName);
      return content !== undefined ? ts.ScriptSnapshot.fromString(content) : undefined;
    },
    getCurrentDirectory: () => projectDir,
    getDefaultLibFileName: (options: ts.CompilerOptions) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    getDirectories: ts.sys.getDirectories,
    directoryExists: ts.sys.directoryExists,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
  };
}

function extractFntypescriptConfig(
  plugins: unknown,
): Record<string, unknown> | undefined {
  if (!Array.isArray(plugins)) return undefined;
  return (plugins as unknown[]).find(
    (p): p is Record<string, unknown> =>
      p !== null &&
      typeof p === "object" &&
      (p as Record<string, unknown>)["name"] === "fntypescript",
  );
}

function makeConsoleLogger(): Parameters<typeof loadSubPlugins>[2] {
  return {
    info: (s: string) => console.warn(s),
    msg: (s: string) => console.error(s),
    close: () => {},
    hasLevel: () => true,
    loggingEnabled: () => true,
    perftrc: () => {},
    startGroup: () => {},
    endGroup: () => {},
    getStartTime: () => String(Date.now()),
  } as unknown as Parameters<typeof loadSubPlugins>[2];
}

function makePluginLogger(pluginName: string): HookContext["logger"] {
  return {
    info: (message: string) => console.warn(`[fntypescript:${pluginName}] ${message}`),
    error: (message: string) => console.error(`[fntypescript:${pluginName}] ERROR: ${message}`),
  };
}

/**
 * Run fntypescript plugin hooks against a TypeScript project, returning all diagnostics.
 *
 * Throws if the tsconfig cannot be found or parsed (CLI converts this to exit code 2).
 */
export function check(options?: CheckOptions): CheckResult {
  const projectPath = path.resolve(options?.project ?? "tsconfig.json");
  const projectDir = path.dirname(projectPath);

  // Parse tsconfig
  const configFile = ts.readConfigFile(projectPath, ts.sys.readFile);
  if (configFile.error) {
    const formatted = ts.formatDiagnostics([configFile.error], {
      getCurrentDirectory: () => projectDir,
      getCanonicalFileName: (f) => f,
      getNewLine: () => "\n",
    });
    throw new Error(`Cannot read tsconfig '${projectPath}': ${formatted.trim()}`);
  }

  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config as Record<string, unknown>,
    ts.sys,
    projectDir,
  );

  // TS18003 = "No inputs were found in config file" — treat as empty project, not a fatal error
  const realErrors = parsedConfig.errors.filter((e) => e.code !== 18003);
  if (realErrors.length > 0) {
    const formatted = ts.formatDiagnostics(realErrors, {
      getCurrentDirectory: () => projectDir,
      getCanonicalFileName: (f) => f,
      getNewLine: () => "\n",
    });
    throw new Error(`tsconfig parse error in '${projectPath}': ${formatted.trim()}`);
  }

  // Resolve plugins
  let plugins: Plugin[];
  if (options?.plugins !== undefined) {
    plugins = options.plugins;
  } else {
    const rawCompilerOptions = (parsedConfig.raw as Record<string, unknown> | undefined)
      ?.["compilerOptions"] as Record<string, unknown> | undefined;
    const fnConfig = extractFntypescriptConfig(rawCompilerOptions?.["plugins"]);
    if (fnConfig) {
      const consoleLogger = makeConsoleLogger();
      const resolveModule = (moduleName: string) => {
        if (moduleName.startsWith(".") || moduleName.startsWith("..")) {
          return path.resolve(projectDir, moduleName);
        }
        return moduleName;
      };
      plugins = loadSubPlugins(
        fnConfig,
        resolveModule,
        consoleLogger,
        require as (id: string) => unknown,
      );
    } else {
      plugins = [];
    }
  }

  const { fileNames, options: compilerOptions } = parsedConfig;

  if (fileNames.length === 0) {
    return { diagnostics: [], exitCode: 0 };
  }

  // Create LanguageService
  const host = createLanguageServiceHost(compilerOptions, fileNames, projectDir);
  const languageService = ts.createLanguageService(host);

  // Build per-plugin config lookup from the fntypescript sub-plugins array in tsconfig
  // (only relevant when plugins come from tsconfig; overridden plugins use empty config)
  const rawCompilerOptions = (parsedConfig.raw as Record<string, unknown> | undefined)
    ?.["compilerOptions"] as Record<string, unknown> | undefined;
  const fnConfig = extractFntypescriptConfig(rawCompilerOptions?.["plugins"]);
  const subPluginsArray = Array.isArray(fnConfig?.["plugins"])
    ? (fnConfig["plugins"] as Record<string, unknown>[])
    : [];

  function getPluginConfig(pluginName: string): Record<string, unknown> {
    const entry = subPluginsArray.find(
      (p) => typeof p === "object" && p !== null && p["name"] === pluginName,
    );
    return (entry as Record<string, unknown> | undefined) ?? {};
  }

  function makeContext(pluginName: string, fileName: string): HookContext {
    return {
      fileName,
      languageService,
      // Cast: check.ts uses `typescript` value but HookContext.typescript is typed for tsserverlibrary
      typescript: ts as unknown as HookContext["typescript"],
      project: undefined,
      config: options?.plugins !== undefined ? {} : getPluginConfig(pluginName),
      logger: makePluginLogger(pluginName),
    };
  }

  // Compose each diagnostic hook once (outside the file loop) for efficiency
  const composedSemantic = composeHook(
    (f: string) => languageService.getSemanticDiagnostics(f),
    plugins,
    "getSemanticDiagnostics",
    makeContext,
  );
  const composedSyntactic = composeHook(
    (f: string) => languageService.getSyntacticDiagnostics(f),
    plugins,
    "getSyntacticDiagnostics",
    makeContext,
  );
  const composedSuggestion = composeHook(
    (f: string) => languageService.getSuggestionDiagnostics(f),
    plugins,
    "getSuggestionDiagnostics",
    makeContext,
  );

  // Collect diagnostics for all files
  const allDiagnostics: ts.Diagnostic[] = [];

  for (const fileName of fileNames) {
    allDiagnostics.push(...composedSemantic(fileName));
    allDiagnostics.push(...composedSyntactic(fileName));
    allDiagnostics.push(...(composedSuggestion(fileName) as ts.Diagnostic[]));
  }

  return {
    diagnostics: allDiagnostics,
    exitCode: allDiagnostics.length > 0 ? 1 : 0,
  };
}
