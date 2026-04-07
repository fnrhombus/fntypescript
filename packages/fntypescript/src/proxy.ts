import type ts from "typescript";

export function createLanguageServiceProxy(baseService: ts.LanguageService): ts.LanguageService {
  const overrides = new Map<PropertyKey, unknown>();

  return new Proxy(baseService, {
    get(target, prop, receiver) {
      if (overrides.has(prop)) return overrides.get(prop);
      const val = Reflect.get(target, prop, receiver);
      return typeof val === "function" ? val.bind(target) : val;
    },
    set(_target, prop, value) {
      overrides.set(prop, value);
      return true;
    },
  }) as ts.LanguageService;
}
