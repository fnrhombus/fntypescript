import type ts from "typescript/lib/tsserverlibrary";

/** The context object passed to every hook */
export interface HookContext {
  fileName: string;
  languageService: ts.LanguageService;
  typescript: typeof ts;
  /** Present in IDE (tsserver) context; undefined in CLI (build-time) context. */
  project?: ts.server.Project;
  config: Record<string, unknown>;
  logger: {
    info(message: string): void;
    error(message: string): void;
  };
}

/** Derives a hook signature from a LanguageService method: prepends ctx + prior to the original params. */
export type Hook<K extends keyof ts.LanguageService> =
  ts.LanguageService[K] extends (...args: infer A) => infer R
    ? (ctx: HookContext, prior: R, ...args: A) => R
    : never;

/** The hookable method names in PluginDefinition (excludes 'name'). */
export type HookName = Exclude<keyof PluginDefinition, "name">;

/** Extract the original LS method args for a hookable method. */
export type HookArgs<K extends HookName> =
  ts.LanguageService[K] extends (...args: infer A) => any ? A : never;

/** Extract the return type of a hookable LS method. */
export type HookResult<K extends HookName> =
  ts.LanguageService[K] extends (...args: any[]) => infer R ? R : never;

/** LanguageService narrowed to only the hookable methods. */
export type HookableService = Pick<ts.LanguageService, HookName>;

/** What plugin authors provide */
export interface PluginDefinition {
  name: string;
  getSemanticDiagnostics?: Hook<"getSemanticDiagnostics">;
  getSyntacticDiagnostics?: Hook<"getSyntacticDiagnostics">;
  getSuggestionDiagnostics?: Hook<"getSuggestionDiagnostics">;
  getCompletionsAtPosition?: Hook<"getCompletionsAtPosition">;
  getCompletionEntryDetails?: Hook<"getCompletionEntryDetails">;
  getQuickInfoAtPosition?: Hook<"getQuickInfoAtPosition">;
  getDefinitionAtPosition?: Hook<"getDefinitionAtPosition">;
  getDefinitionAndBoundSpan?: Hook<"getDefinitionAndBoundSpan">;
  getSignatureHelpItems?: Hook<"getSignatureHelpItems">;
  getCodeFixesAtPosition?: Hook<"getCodeFixesAtPosition">;
}

/** The resolved plugin object */
export interface Plugin {
  readonly name: string;
  /** @internal */ readonly definition: PluginDefinition;
}
