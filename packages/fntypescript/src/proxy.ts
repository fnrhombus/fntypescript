import type ts from "typescript";

export function createLanguageServiceProxy(baseService: ts.LanguageService): ts.LanguageService {
  return Object.fromEntries(
    (Object.keys(baseService) as Array<keyof ts.LanguageService>).map((key) => {
      const original = baseService[key];
      return [
        key,
        typeof original === "function"
          ? (...args: unknown[]) => (original as Function).apply(baseService, args)
          : original,
      ];
    }),
  ) as unknown as ts.LanguageService;
}
