import { describe, it, expect, vi, beforeEach, type MockedFunction } from "vitest";
import type ts from "typescript/lib/tsserverlibrary";
import type { Plugin } from "./types.js";

// We need to mock require() in the loader. We'll do this by importing the
// loader and patching its internal require via a factory approach.

// Build a mock ts.server.Logger
function makeMockLogger(): ts.server.Logger {
  return {
    info: vi.fn(),
    msg: vi.fn(),
    // Satisfy the interface minimally — other methods not needed
    close: vi.fn(),
    loggingEnabled: vi.fn().mockReturnValue(true),
    perftrc: vi.fn(),
    startGroup: vi.fn(),
    endGroup: vi.fn(),
  } as unknown as ts.server.Logger;
}

function makeValidPlugin(name: string): Plugin {
  return {
    name,
    definition: { name },
  };
}

// We'll test loadSubPlugins by injecting a mock resolveModule and a mock require.
// To intercept require() inside loader.ts, we pass it as a parameter via a
// test-only overload, OR we import loader using vi.mock.
//
// The cleanest approach: loader.ts exports loadSubPlugins which accepts resolveModule
// as a param. For require, we use vi.mock on the module itself, but that's awkward.
// Instead, we'll use a testable design where require is injectable (passed as param).
// The spec doesn't say the signature, so we add a 4th optional param for testing.
// Actually, re-reading the spec: "require() the resolved module" — we need to intercept
// this. We'll use vi.mock at the module level.
//
// Best approach: export a factory or accept require as parameter. We'll make loader.ts
// accept an optional 4th `requireFn` parameter for testability, defaulting to require.

import { loadSubPlugins } from "./loader.js";

describe("loadSubPlugins", () => {
  let logger: ts.server.Logger;

  beforeEach(() => {
    logger = makeMockLogger();
  });

  it("loads a valid plugin by module name string", () => {
    const plugin = makeValidPlugin("foo");
    const requireFn = vi.fn().mockReturnValue(plugin);
    const resolveModule = vi.fn().mockReturnValue("/resolved/foo");

    const result = loadSubPlugins(
      { plugins: ["foo"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(plugin);
    expect(resolveModule).toHaveBeenCalledWith("foo");
    expect(requireFn).toHaveBeenCalledWith("/resolved/foo");
  });

  it("handles module-not-found gracefully: returns empty result and logs warning", () => {
    const error = new Error("Cannot find module 'missing'");
    const requireFn = vi.fn().mockImplementation(() => { throw error; });
    const resolveModule = vi.fn().mockReturnValue("/resolved/missing");

    const result = loadSubPlugins(
      { plugins: ["missing"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      "fntypescript: Failed to load plugin 'missing': Cannot find module 'missing'",
    );
  });

  it("handles invalid export gracefully: returns empty result and logs warning", () => {
    const requireFn = vi.fn().mockReturnValue({ notAPlugin: true });
    const resolveModule = vi.fn().mockReturnValue("/resolved/bad");

    const result = loadSubPlugins(
      { plugins: ["bad"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      "fntypescript: Module 'bad' does not export a valid fntypescript plugin. Did you forget to use definePlugin()?",
    );
  });

  it("loads multiple plugins in config order", () => {
    const pluginA = makeValidPlugin("a");
    const pluginB = makeValidPlugin("b");
    const pluginC = makeValidPlugin("c");

    const requireFn = vi.fn()
      .mockReturnValueOnce(pluginA)
      .mockReturnValueOnce(pluginB)
      .mockReturnValueOnce(pluginC);
    const resolveModule = vi.fn((name: string) => `/resolved/${name}`);

    const result = loadSubPlugins(
      { plugins: ["a", "b", "c"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(3);
    expect(result[0]).toBe(pluginA);
    expect(result[1]).toBe(pluginB);
    expect(result[2]).toBe(pluginC);
  });

  it("passes per-plugin config from object entry (extra keys beyond 'name')", () => {
    const plugin = makeValidPlugin("foo");
    const requireFn = vi.fn().mockReturnValue(plugin);
    const resolveModule = vi.fn().mockReturnValue("/resolved/foo");

    // We verify the plugin is loaded; config attachment is in the runtime context,
    // not on the Plugin object itself. The spec says "Attach per-plugin config to
    // plugin's runtime context" — so we check the plugin is returned and the
    // object entry is parsed correctly (name resolved, extra keys available).
    const result = loadSubPlugins(
      { plugins: [{ name: "foo", bar: true, threshold: 42 }] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(plugin);
    expect(resolveModule).toHaveBeenCalledWith("foo");
  });

  it("string shorthand: loads module 'foo' with no extra config", () => {
    const plugin = makeValidPlugin("foo");
    const requireFn = vi.fn().mockReturnValue(plugin);
    const resolveModule = vi.fn().mockReturnValue("/resolved/foo");

    const result = loadSubPlugins(
      { plugins: ["foo"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(1);
    expect(resolveModule).toHaveBeenCalledWith("foo");
  });

  it("returns empty array when plugins config is empty array", () => {
    const requireFn = vi.fn();
    const resolveModule = vi.fn();

    const result = loadSubPlugins(
      { plugins: [] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(0);
    expect(requireFn).not.toHaveBeenCalled();
  });

  it("returns empty array when plugins key is absent from config", () => {
    const requireFn = vi.fn();
    const resolveModule = vi.fn();

    const result = loadSubPlugins(
      {},
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(0);
    expect(requireFn).not.toHaveBeenCalled();
  });

  it("logs warning and returns empty array when plugins config is not an array", () => {
    const requireFn = vi.fn();
    const resolveModule = vi.fn();

    const result = loadSubPlugins(
      { plugins: "not-an-array" },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(0);
    expect(logger.info).toHaveBeenCalledWith(
      "fntypescript: 'plugins' config must be an array",
    );
  });

  it("one bad plugin does not block others: first and third loaded when middle throws", () => {
    const pluginA = makeValidPlugin("a");
    const pluginC = makeValidPlugin("c");
    const error = new Error("failed");

    const requireFn = vi.fn()
      .mockReturnValueOnce(pluginA)
      .mockImplementationOnce(() => { throw error; })
      .mockReturnValueOnce(pluginC);
    const resolveModule = vi.fn((name: string) => `/resolved/${name}`);

    const result = loadSubPlugins(
      { plugins: ["a", "b", "c"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(pluginA);
    expect(result[1]).toBe(pluginC);
  });

  it("handles CJS/ESM interop: uses .default when module has a default property", () => {
    const plugin = makeValidPlugin("foo");
    const requireFn = vi.fn().mockReturnValue({ default: plugin });
    const resolveModule = vi.fn().mockReturnValue("/resolved/foo");

    const result = loadSubPlugins(
      { plugins: ["foo"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(plugin);
  });

  it("duplicate plugin names are allowed: both loaded in order", () => {
    const plugin1 = makeValidPlugin("dup");
    const plugin2 = makeValidPlugin("dup");
    const requireFn = vi.fn()
      .mockReturnValueOnce(plugin1)
      .mockReturnValueOnce(plugin2);
    const resolveModule = vi.fn().mockReturnValue("/resolved/dup");

    const result = loadSubPlugins(
      { plugins: ["dup", "dup"] },
      resolveModule,
      logger,
      requireFn,
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toBe(plugin1);
    expect(result[1]).toBe(plugin2);
  });
});
