import type ts from "typescript";

export function createLanguageServiceProxy(baseService: ts.LanguageService): ts.LanguageService {
  const proxy = Object.create(null) as ts.LanguageService;
  for (const key of Object.keys(baseService) as Array<keyof ts.LanguageService>) {
    const original = baseService[key];
    if (typeof original === "function") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (proxy as any)[key] = (...args: unknown[]) => (original as Function).apply(baseService, args);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (proxy as any)[key] = original;
    }
  }
  return proxy;
}
