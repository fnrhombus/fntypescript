import { describe, it, expect, vi } from "vitest";
import { createLanguageServiceProxy } from "../../fntypescript/dist/proxy.js";

function makeBaseService(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    getCompletionsAtPosition: vi.fn().mockReturnValue({ entries: [] }),
    getQuickInfoAtPosition: vi.fn().mockReturnValue({ kind: "keyword" }),
    dispose: vi.fn(),
    ...overrides,
  };
}

describe("createLanguageServiceProxy", () => {
  it("delegates all methods to the base service", () => {
    const base = makeBaseService();
    const proxy = createLanguageServiceProxy(base as never);

    (proxy as unknown as Record<string, (...a: unknown[]) => unknown>)["getCompletionsAtPosition"]("file.ts", 0, {});
    (proxy as unknown as Record<string, (...a: unknown[]) => unknown>)["getQuickInfoAtPosition"]("file.ts", 0);

    expect(base["getCompletionsAtPosition"]).toHaveBeenCalledOnce();
    expect(base["getQuickInfoAtPosition"]).toHaveBeenCalledOnce();
  });

  it("passes return values through unchanged", () => {
    const returnValue = { entries: [{ name: "foo" }] };
    const base = makeBaseService({
      getCompletionsAtPosition: vi.fn().mockReturnValue(returnValue),
    });
    const proxy = createLanguageServiceProxy(base as never);

    const result = (proxy as unknown as Record<string, (...a: unknown[]) => unknown>)[
      "getCompletionsAtPosition"
    ]("file.ts", 0, {});

    expect(result).toBe(returnValue);
  });

  it("forwards arguments correctly", () => {
    const base = makeBaseService();
    const proxy = createLanguageServiceProxy(base as never);

    (proxy as unknown as Record<string, (...a: unknown[]) => unknown>)[
      "getCompletionsAtPosition"
    ]("file.ts", 42, { triggerKind: 1 });

    expect(base["getCompletionsAtPosition"]).toHaveBeenCalledWith("file.ts", 42, { triggerKind: 1 });
  });

  it("preserves this binding so methods can reference other methods on the base service", () => {
    type FakeService = { helper: () => string; getCompletionsAtPosition: () => string };
    const base: FakeService = {
      helper: vi.fn().mockReturnValue("helped"),
      getCompletionsAtPosition: function (this: FakeService) {
        return this.helper();
      },
    };
    const proxy = createLanguageServiceProxy(base as never);

    const result = (proxy as unknown as Record<string, () => unknown>)["getCompletionsAtPosition"]();

    expect(result).toBe("helped");
    expect(base.helper).toHaveBeenCalledOnce();
  });

  it("proxies extra methods not in TS type definitions", () => {
    const base = makeBaseService({
      __internalExtraMethod: vi.fn().mockReturnValue("extra"),
    });
    const proxy = createLanguageServiceProxy(base as never);

    const result = (proxy as unknown as Record<string, () => unknown>)["__internalExtraMethod"]();

    expect(result).toBe("extra");
  });

  it("copies non-function properties as-is", () => {
    const base = makeBaseService({
      version: "5.7.0",
      isSync: true,
    });
    const proxy = createLanguageServiceProxy(base as never);

    expect((proxy as unknown as Record<string, unknown>)["version"]).toBe("5.7.0");
    expect((proxy as unknown as Record<string, unknown>)["isSync"]).toBe(true);
  });

  it("uses the override when a method is replaced via property assignment", () => {
    const base = makeBaseService();
    const proxy = createLanguageServiceProxy(base as never);
    const override = vi.fn().mockReturnValue({ entries: [{ name: "overridden" }] });

    (proxy as unknown as Record<string, unknown>)["getCompletionsAtPosition"] = override;
    const result = (proxy as unknown as Record<string, (...a: unknown[]) => unknown>)[
      "getCompletionsAtPosition"
    ]("file.ts", 0, {});

    expect(result).toEqual({ entries: [{ name: "overridden" }] });
    expect(base["getCompletionsAtPosition"]).not.toHaveBeenCalled();
  });

  it("multiple overrides do not interfere with each other", () => {
    const base = makeBaseService();
    const proxy = createLanguageServiceProxy(base as never);
    const overrideA = vi.fn().mockReturnValue("A");
    const overrideB = vi.fn().mockReturnValue("B");

    (proxy as unknown as Record<string, unknown>)["getCompletionsAtPosition"] = overrideA;
    (proxy as unknown as Record<string, unknown>)["getQuickInfoAtPosition"] = overrideB;

    const resultA = (proxy as unknown as Record<string, () => unknown>)["getCompletionsAtPosition"]();
    const resultB = (proxy as unknown as Record<string, () => unknown>)["getQuickInfoAtPosition"]();

    expect(resultA).toBe("A");
    expect(resultB).toBe("B");
    expect(base["getCompletionsAtPosition"]).not.toHaveBeenCalled();
    expect(base["getQuickInfoAtPosition"]).not.toHaveBeenCalled();
  });
});
