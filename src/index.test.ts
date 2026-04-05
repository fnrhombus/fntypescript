import { describe, it, expect, vi } from "vitest";
import type ts from "typescript";

type PluginModule = {
  create: (info: ts.server.PluginCreateInfo) => ts.LanguageService;
  getExternalFiles: () => string[];
};

function makeTs(): typeof ts {
  return {} as typeof ts;
}

function makeBaseService(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    getCompletionsAtPosition: vi.fn().mockReturnValue({ entries: [] }),
    getQuickInfoAtPosition: vi.fn().mockReturnValue({ kind: "keyword" }),
    dispose: vi.fn(),
    ...overrides,
  };
}

function makePluginCreateInfo(overrides: Partial<ts.server.PluginCreateInfo> = {}): ts.server.PluginCreateInfo {
  return {
    languageService: makeBaseService() as unknown as ts.LanguageService,
    languageServiceHost: {} as ts.LanguageServiceHost,
    serverHost: {} as ts.server.ServerHost,
    project: {} as ts.server.Project,
    config: {},
    ...overrides,
  } as ts.server.PluginCreateInfo;
}

// index.ts uses `export =` (CJS required by tsserver). Vitest/Vite transpiles this
// so the module default is the init function.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import initModule from "./index.js";
const init = initModule as unknown as (modules: { typescript: typeof ts }) => PluginModule;

describe("init", () => {
  it("returns an object with create and getExternalFiles functions", () => {
    const plugin = init({ typescript: makeTs() });

    expect(typeof plugin.create).toBe("function");
    expect(typeof plugin.getExternalFiles).toBe("function");
  });

  it("create returns a LanguageService proxy", () => {
    const plugin = init({ typescript: makeTs() });
    const baseService = makeBaseService();
    const info = makePluginCreateInfo({
      languageService: baseService as unknown as ts.LanguageService,
    });

    const proxy = plugin.create(info);

    expect(proxy).toBeDefined();
    expect(typeof (proxy as unknown as Record<string, unknown>)["getCompletionsAtPosition"]).toBe("function");
  });

  it("proxy delegates to the base language service", () => {
    const plugin = init({ typescript: makeTs() });
    const baseService = makeBaseService();
    const info = makePluginCreateInfo({
      languageService: baseService as unknown as ts.LanguageService,
    });

    const proxy = plugin.create(info);
    (proxy as unknown as Record<string, (...a: unknown[]) => unknown>)["getCompletionsAtPosition"]("file.ts", 0, {});

    expect(baseService["getCompletionsAtPosition"]).toHaveBeenCalledOnce();
  });

  it("getExternalFiles returns an empty array", () => {
    const plugin = init({ typescript: makeTs() });

    expect(plugin.getExternalFiles()).toEqual([]);
  });

  it("info.config is stored but does not affect behavior", () => {
    const plugin = init({ typescript: makeTs() });
    const config = { someOption: true };
    const info = makePluginCreateInfo({ config });

    const proxy = plugin.create(info);

    expect(proxy).toBeDefined();
    expect(plugin.getExternalFiles()).toEqual([]);
  });
});
