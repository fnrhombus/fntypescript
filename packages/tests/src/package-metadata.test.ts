import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const pkg = JSON.parse(
  readFileSync(resolve(__dirname, "../../fntypescript/package.json"), "utf-8"),
) as Record<string, unknown>;

const exportsMap = pkg["exports"] as Record<string, unknown> | undefined;

describe("package.json exports map", () => {
  it("does not export ./proxy.js", () => {
    expect(exportsMap).not.toHaveProperty("./proxy.js");
  });

  it("does not export ./loader.js", () => {
    expect(exportsMap).not.toHaveProperty("./loader.js");
  });

  it("exports '.' for the main entry point", () => {
    expect(exportsMap).toHaveProperty(".");
  });

  it("exports './define-plugin.js'", () => {
    expect(exportsMap).toHaveProperty("./define-plugin.js");
  });

  it("exports './types.js'", () => {
    expect(exportsMap).toHaveProperty("./types.js");
  });
});

describe("package.json metadata", () => {
  it("has license field set to MIT", () => {
    expect(pkg["license"]).toBe("MIT");
  });

  it("has repository field with git url", () => {
    const repo = pkg["repository"] as Record<string, unknown> | undefined;
    expect(repo).toBeDefined();
    expect(repo?.["type"]).toBe("git");
    expect(repo?.["url"]).toContain("fnrhombus/fntypescript");
  });

  it("has keywords array including 'typescript' and 'language-service'", () => {
    const keywords = pkg["keywords"] as string[] | undefined;
    expect(Array.isArray(keywords)).toBe(true);
    expect(keywords).toContain("typescript");
    expect(keywords).toContain("language-service");
  });

  it("has homepage field", () => {
    expect(pkg["homepage"]).toContain("fnrhombus/fntypescript");
  });

  it("has files field containing 'dist' and 'LICENSE'", () => {
    const files = pkg["files"] as string[] | undefined;
    expect(Array.isArray(files)).toBe(true);
    expect(files).toContain("dist");
    expect(files).toContain("LICENSE");
  });
});
