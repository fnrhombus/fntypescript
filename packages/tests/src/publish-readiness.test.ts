import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

const packageDir = resolve(__dirname, "../../fntypescript");
const repoRoot = resolve(__dirname, "../../..");

const pkg = JSON.parse(
  readFileSync(join(packageDir, "package.json"), "utf-8"),
) as Record<string, unknown>;

// ---------------------------------------------------------------------------
// Tarball contents
// ---------------------------------------------------------------------------

describe("npm pack tarball contents", () => {
  let packFiles: string[];
  let packSize: number;

  beforeAll(() => {
    const raw = execSync("npm pack --dry-run --json", {
      cwd: packageDir,
      encoding: "utf-8",
    });
    const parsed = JSON.parse(raw) as Array<{
      files: Array<{ path: string }>;
      size: number;
    }>;
    packFiles = parsed[0]!.files.map((f) => f.path);
    packSize = parsed[0]!.size;
  });

  it("contains only dist/, LICENSE, and package.json", () => {
    const unexpected = packFiles.filter(
      (p) => !p.startsWith("dist/") && p !== "LICENSE" && p !== "package.json",
    );
    expect(unexpected).toHaveLength(0);
  });

  it("does not include src/ directory", () => {
    expect(packFiles.some((p) => p.startsWith("src/"))).toBe(false);
  });

  it("does not include test files", () => {
    expect(packFiles.some((p) => p.includes(".test."))).toBe(false);
  });

  it("does not include dotfiles or config files (tsconfig, etc.)", () => {
    const configFiles = packFiles.filter(
      (p) =>
        p.startsWith(".") ||
        p.includes("tsconfig") ||
        (p.endsWith(".json") && p !== "package.json"),
    );
    expect(configFiles).toHaveLength(0);
  });

  it("tarball size is reasonable (under 50 kB)", () => {
    expect(packSize).toBeLessThan(50_000);
  });
});

// ---------------------------------------------------------------------------
// Package metadata (fields not covered by package-metadata.test.ts)
// ---------------------------------------------------------------------------

describe("package.json additional metadata", () => {
  it("version is 0.1.0", () => {
    expect(pkg["version"]).toBe("0.1.0");
  });

  it("engines.node is >=18", () => {
    const engines = pkg["engines"] as Record<string, string> | undefined;
    expect(engines?.["node"]).toBe(">=18");
  });

  it("peerDependencies.typescript is >=5.0.0", () => {
    const peers = pkg["peerDependencies"] as Record<string, string> | undefined;
    expect(peers?.["typescript"]).toBe(">=5.0.0");
  });

  it("has no runtime dependencies (devDependencies do not leak)", () => {
    expect(pkg["dependencies"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Exports map entry structure
// ---------------------------------------------------------------------------

describe("exports map entry structure", () => {
  const exportsMap = pkg["exports"] as Record<string, unknown>;

  it("'.' entry has types, import, and require conditions", () => {
    const entry = exportsMap["."] as Record<string, unknown>;
    expect(entry).toHaveProperty("types");
    expect(entry).toHaveProperty("import");
    expect(entry).toHaveProperty("require");
  });

  it("'./define-plugin.js' entry has types, import, and require conditions", () => {
    const entry = exportsMap["./define-plugin.js"] as Record<string, unknown>;
    expect(entry).toHaveProperty("types");
    expect(entry).toHaveProperty("import");
    expect(entry).toHaveProperty("require");
  });

  it("'./types.js' entry has types condition only (no import/require)", () => {
    const entry = exportsMap["./types.js"] as Record<string, unknown>;
    expect(entry).toHaveProperty("types");
    expect(entry).not.toHaveProperty("import");
    expect(entry).not.toHaveProperty("require");
  });
});

// ---------------------------------------------------------------------------
// Functional smoke test — pack real tgz, install in temp project, verify
// ---------------------------------------------------------------------------

describe("functional smoke test", () => {
  let tempDir: string;
  let tgzPath: string;

  beforeAll(
    () => {
      const packOutput = execSync("npm pack --json", {
        cwd: packageDir,
        encoding: "utf-8",
      });
      const parsed = JSON.parse(packOutput) as Array<{ filename: string }>;
      tgzPath = join(packageDir, parsed[0]!.filename);

      tempDir = mkdtempSync(join(tmpdir(), "fntypescript-smoke-"));
      writeFileSync(
        join(tempDir, "package.json"),
        JSON.stringify({ name: "smoke-test", version: "1.0.0" }),
      );
      execSync(`npm install --no-package-lock "${tgzPath}"`, {
        cwd: tempDir,
        stdio: "pipe",
      });
    },
    120_000,
  );

  afterAll(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    if (tgzPath && existsSync(tgzPath)) rmSync(tgzPath);
  });

  it("main entry (require('fntypescript')) loads and is callable", () => {
    const result = spawnSync(
      "node",
      [
        "-e",
        `const init = require('fntypescript'); if (typeof init !== 'function') { process.exit(1); }`,
      ],
      { cwd: tempDir, encoding: "utf-8" },
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it("define-plugin.js entry resolves and exports definePlugin", () => {
    const result = spawnSync(
      "node",
      [
        "-e",
        `const { definePlugin } = require('fntypescript/define-plugin.js'); if (typeof definePlugin !== 'function') { process.exit(1); }`,
      ],
      { cwd: tempDir, encoding: "utf-8" },
    );
    expect(result.status, result.stderr).toBe(0);
  });

  it("proxy.js is not accessible (not in exports map)", () => {
    const result = spawnSync(
      "node",
      ["-e", `require('fntypescript/proxy.js')`],
      { cwd: tempDir, encoding: "utf-8" },
    );
    expect(result.status).not.toBe(0);
  });

  it("loader.js is not accessible (not in exports map)", () => {
    const result = spawnSync(
      "node",
      ["-e", `require('fntypescript/loader.js')`],
      { cwd: tempDir, encoding: "utf-8" },
    );
    expect(result.status).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// CI configuration
// ---------------------------------------------------------------------------

describe("CI configuration", () => {
  it("GitHub Actions CI workflow file exists", () => {
    const ciPath = join(repoRoot, ".github", "workflows", "ci.yml");
    expect(existsSync(ciPath)).toBe(true);
  });

  it("CI workflow runs on Node 18, 20, and 22", () => {
    const ciPath = join(repoRoot, ".github", "workflows", "ci.yml");
    const ciContent = readFileSync(ciPath, "utf-8");
    expect(ciContent).toContain("18");
    expect(ciContent).toContain("20");
    expect(ciContent).toContain("22");
  });
});

// ---------------------------------------------------------------------------
// Documentation
// ---------------------------------------------------------------------------

describe("documentation", () => {
  it("README.md exists at repo root", () => {
    expect(existsSync(join(repoRoot, "README.md"))).toBe(true);
  });

  it("LICENSE exists at repo root", () => {
    expect(existsSync(join(repoRoot, "LICENSE"))).toBe(true);
  });

  it("LICENSE exists in packages/fntypescript/", () => {
    expect(existsSync(join(packageDir, "LICENSE"))).toBe(true);
  });
});
