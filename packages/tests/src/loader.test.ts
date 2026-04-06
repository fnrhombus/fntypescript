import { describe, it, expect, vi } from "vitest";
import type ts from "typescript/lib/tsserverlibrary";
import { definePlugin } from "fntypescript/define-plugin.js";
import { loadSubPlugins } from "fntypescript/loader.js";

function makeMockLogger() {
  return {
    info: vi.fn<(message: string) => void>(),
    msg: vi.fn<(message: string, type: unknown) => void>(),
    close: vi.fn(),
    endGroup: vi.fn(),
    getStartTime: vi.fn(() => ""),
    hasLevel: vi.fn(() => true),
    loggingEnabled: vi.fn(() => true),
    perftrc: vi.fn(),
    startGroup: vi.fn(),
  } as unknown as ts.server.Logger;
}

describe("loadSubPlugins", () => {
  it("loads a valid plugin by name", () => {
    const plugin = definePlugin({ name: "my-plugin" });
    const resolveModule = vi.fn((name: string) => `/resolved/${name}`);
    const requireFn = vi.fn(() => plugin);
    const logger = makeMockLogger();

    const result = loadSubPlugins(
      { plugins: ["my-plugin"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("my-plugin");
  });

  it("handles module-not-found gracefully", () => {
    const resolveModule = vi.fn((name: string) => `/resolved/${name}`);
    const requireFn = vi.fn(() => { throw new Error("Cannot find module 'bad-plugin'"); });
    const logger = makeMockLogger();

    const result = loadSubPlugins(
      { plugins: ["bad-plugin"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("fntypescript: Failed to load plugin 'bad-plugin'"),
    );
  });

  it("handles invalid export gracefully", () => {
    const resolveModule = vi.fn((name: string) => `/resolved/${name}`);
    const requireFn = vi.fn(() => ({ notAPlugin: true }));
    const logger = makeMockLogger();

    const result = loadSubPlugins(
      { plugins: ["bad-export"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      "fntypescript: Module 'bad-export' does not export a valid fntypescript plugin. Did you forget to use definePlugin()?",
    );
  });

  it("loads multiple plugins in order", () => {
    const pluginA = definePlugin({ name: "plugin-a" });
    const pluginB = definePlugin({ name: "plugin-b" });
    const pluginC = definePlugin({ name: "plugin-c" });

    const modules: Record<string, unknown> = {
      "plugin-a": pluginA,
      "plugin-b": pluginB,
      "plugin-c": pluginC,
    };
    const resolveModule = vi.fn((name: string) => name);
    const requireFn = vi.fn((path: string) => modules[path]);
    const logger = makeMockLogger();

    const result = loadSubPlugins(
      { plugins: ["plugin-a", "plugin-b", "plugin-c"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(3);
    expect(result[0].name).toBe("plugin-a");
    expect(result[1].name).toBe("plugin-b");
    expect(result[2].name).toBe("plugin-c");
  });

  it("passes per-plugin config when entry is an object", () => {
    let capturedConfig: Record<string, unknown> | undefined;
    const plugin = definePlugin({
      name: "foo",
      getSemanticDiagnostics: (ctx) => {
        capturedConfig = ctx.config;
        return [];
      },
    });

    const resolveModule = vi.fn((name: string) => name);
    const requireFn = vi.fn(() => plugin);
    const logger = makeMockLogger();

    const result = loadSubPlugins(
      { plugins: [{ name: "foo", bar: true, baz: "hello" }] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(1);
    expect(result[0].config).toEqual({ name: "foo", bar: true, baz: "hello" });
  });

  it("loads string shorthand with empty config", () => {
    const plugin = definePlugin({ name: "foo" });
    const resolveModule = vi.fn((name: string) => name);
    const requireFn = vi.fn(() => plugin);
    const logger = makeMockLogger();

    const result = loadSubPlugins(
      { plugins: ["foo"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(1);
    expect(result[0].config).toEqual({});
  });

  it("returns empty array for empty plugins config", () => {
    const logger = makeMockLogger();
    const resolveModule = vi.fn();
    const requireFn = vi.fn();

    const result = loadSubPlugins({ plugins: [] }, resolveModule, logger, requireFn);

    expect(result).toHaveLength(0);
  });

  it("returns empty array when plugins key is absent", () => {
    const logger = makeMockLogger();
    const resolveModule = vi.fn();
    const requireFn = vi.fn();

    const result = loadSubPlugins({}, resolveModule, logger, requireFn);

    expect(result).toHaveLength(0);
  });

  it("logs warning and treats as empty when plugins is not an array", () => {
    const logger = makeMockLogger();
    const resolveModule = vi.fn();
    const requireFn = vi.fn();

    const result = loadSubPlugins({ plugins: "not-an-array" }, resolveModule, logger, requireFn);

    expect(result).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      "fntypescript: 'plugins' config must be an array",
    );
  });

  it("one bad plugin does not block others", () => {
    const pluginA = definePlugin({ name: "plugin-a" });
    const pluginC = definePlugin({ name: "plugin-c" });

    const resolveModule = vi.fn((name: string) => name);
    const requireFn = vi.fn((path: string) => {
      if (path === "plugin-b") throw new Error("Cannot find module");
      if (path === "plugin-a") return pluginA;
      if (path === "plugin-c") return pluginC;
    });
    const logger = makeMockLogger();

    const result = loadSubPlugins(
      { plugins: ["plugin-a", "plugin-b", "plugin-c"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("plugin-a");
    expect(result[1].name).toBe("plugin-c");
  });
});
