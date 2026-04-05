import type ts from "typescript/lib/tsserverlibrary";

/** The context object passed to every hook */
export interface HookContext {
  fileName: string;
  languageService: ts.LanguageService;
  typescript: typeof ts;
  project: ts.server.Project;
  config: Record<string, unknown>;
  logger: {
    info(message: string): void;
    error(message: string): void;
  };
}

/** What plugin authors provide */
export interface PluginDefinition {
  name: string;
  getSemanticDiagnostics?(ctx: HookContext, prior: ts.Diagnostic[], fileName: string): ts.Diagnostic[];
  getSyntacticDiagnostics?(ctx: HookContext, prior: ts.DiagnosticWithLocation[], fileName: string): ts.DiagnosticWithLocation[];
  getSuggestionDiagnostics?(ctx: HookContext, prior: ts.DiagnosticWithLocation[], fileName: string): ts.DiagnosticWithLocation[];
  getCompletionsAtPosition?(ctx: HookContext, prior: ts.CompletionInfo | undefined, fileName: string, position: number, options: ts.GetCompletionsAtPositionOptions | undefined): ts.CompletionInfo | undefined;
  getCompletionEntryDetails?(ctx: HookContext, prior: ts.CompletionEntryDetails | undefined, fileName: string, position: number, name: string, formatOptions: ts.FormatCodeOptions | ts.FormatCodeSettings | undefined, source: string | undefined, preferences: ts.UserPreferences | undefined, data: ts.CompletionEntryData | undefined): ts.CompletionEntryDetails | undefined;
  getQuickInfoAtPosition?(ctx: HookContext, prior: ts.QuickInfo | undefined, fileName: string, position: number): ts.QuickInfo | undefined;
  getDefinitionAtPosition?(ctx: HookContext, prior: readonly ts.DefinitionInfo[] | undefined, fileName: string, position: number): readonly ts.DefinitionInfo[] | undefined;
  getDefinitionAndBoundSpan?(ctx: HookContext, prior: ts.DefinitionInfoAndBoundSpan | undefined, fileName: string, position: number): ts.DefinitionInfoAndBoundSpan | undefined;
  getSignatureHelpItems?(ctx: HookContext, prior: ts.SignatureHelpItems | undefined, fileName: string, position: number, options: ts.SignatureHelpItemsOptions | undefined): ts.SignatureHelpItems | undefined;
  getCodeFixesAtPosition?(ctx: HookContext, prior: readonly ts.CodeFixAction[], fileName: string, start: number, end: number, errorCodes: readonly number[], formatOptions: ts.FormatCodeSettings, preferences: ts.UserPreferences): readonly ts.CodeFixAction[];
}

/** The resolved plugin object */
export interface Plugin {
  readonly name: string;
  /** @internal */ readonly definition: PluginDefinition;
}
