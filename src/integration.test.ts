import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import { TsServerHarness } from "./tsserver-harness.js";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(__dirname, "..");
const FIXTURE_DIR = path.join(ROOT, "test-fixtures", "basic-project");
const TSC_BIN = path.join(ROOT, "node_modules", ".bin", "tsc");
const TSSERVER_BIN = path.join(ROOT, "node_modules", "typescript", "bin", "tsserver");
const NODE_BIN = process.execPath;

const FIXTURE_TSCONFIG = path.join(FIXTURE_DIR, "tsconfig.json");
const FIXTURE_TSCONFIG_NOPLUGIN = path.join(FIXTURE_DIR, "tsconfig.noplugin.json");
const FIXTURE_INDEX = path.join(FIXTURE_DIR, "src", "index.ts");
const FIXTURE_FUNCTIONS = path.join(FIXTURE_DIR, "src", "functions.ts");

let harness: TsServerHarness | undefined;

beforeAll(async () => {
  // Build the plugin so tsserver can load it
  await execFileAsync(NODE_BIN, [TSC_BIN], { cwd: ROOT });

  // Create symlink so tsserver can resolve "fntypescript" from fixture project
  const nodeModulesDir = path.join(FIXTURE_DIR, "node_modules");
  const symlinkTarget = path.join(nodeModulesDir, "fntypescript");
  if (!fs.existsSync(symlinkTarget)) {
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.symlinkSync(ROOT, symlinkTarget);
  }

  harness = new TsServerHarness(TSSERVER_BIN, NODE_BIN, FIXTURE_DIR);
  await harness.start();
}, 60_000);

afterAll(async () => {
  await harness?.close();

  // Clean up symlink
  const symlinkTarget = path.join(FIXTURE_DIR, "node_modules", "fntypescript");
  if (fs.existsSync(symlinkTarget)) {
    fs.rmSync(symlinkTarget, { recursive: true, force: true });
  }
});

// Scenario 1: No-plugin baseline — tsc with no plugin tsconfig reports zero errors
describe("tsc baseline (no plugin)", () => {
  it("reports zero type errors", async () => {
    const result = await execFileAsync(NODE_BIN, [TSC_BIN, "--project", FIXTURE_TSCONFIG_NOPLUGIN, "--noEmit"], {
      cwd: ROOT,
    }).then(() => ({ exitCode: 0, stderr: "" })).catch((err) => ({
      exitCode: err.code as number,
      stderr: (err.stderr ?? err.stdout ?? "") as string,
    }));

    expect(result.exitCode).toBe(0);
  });
});

// Scenario 2: Plugin in tsconfig, tsc still passes
describe("tsc with plugin in tsconfig", () => {
  it("reports zero type errors", async () => {
    const result = await execFileAsync(NODE_BIN, [TSC_BIN, "--project", FIXTURE_TSCONFIG, "--noEmit"], {
      cwd: ROOT,
    }).then(() => ({ exitCode: 0 })).catch((err) => ({
      exitCode: err.code as number,
    }));

    expect(result.exitCode).toBe(0);
  });
});

// Scenario 3: tsserver — semantic diagnostics unchanged (zero)
describe("tsserver: semantic diagnostics", () => {
  it("returns zero semantic diagnostics for index.ts", async () => {
    const diags = await harness!.getSemanticDiagnostics(FIXTURE_INDEX);
    expect(diags).toHaveLength(0);
  });

  it("returns zero semantic diagnostics for functions.ts", async () => {
    const diags = await harness!.getSemanticDiagnostics(FIXTURE_FUNCTIONS);
    expect(diags).toHaveLength(0);
  });
});

// Scenario 4: tsserver — syntactic diagnostics unchanged (zero)
describe("tsserver: syntactic diagnostics", () => {
  it("returns zero syntactic diagnostics for index.ts", async () => {
    const diags = await harness!.getSyntacticDiagnostics(FIXTURE_INDEX);
    expect(diags).toHaveLength(0);
  });

  it("returns zero syntactic diagnostics for functions.ts", async () => {
    const diags = await harness!.getSyntacticDiagnostics(FIXTURE_FUNCTIONS);
    expect(diags).toHaveLength(0);
  });
});

// Scenario 5: tsserver — completions work
describe("tsserver: completions", () => {
  it("returns non-empty completions in functions.ts", async () => {
    // functions.ts line 9: "  const perms = getPermissions(user.role);"
    // "user." starts at col 34, "role" at col 39. Requesting at col 39 triggers member completions.
    const completions = await harness!.getCompletions(FIXTURE_FUNCTIONS, 9, 39);
    expect(completions.length).toBeGreaterThan(0);
  });
});

// Scenario 6: tsserver — quickinfo/hover works
describe("tsserver: quickinfo", () => {
  it("returns type info for formatUser function", async () => {
    // functions.ts line 13: "export function formatUser(user: User): string {"
    // "formatUser" starts at col 17
    const info = await harness!.getQuickInfo(FIXTURE_FUNCTIONS, 13, 17);
    expect(info).toBeDefined();
    expect(info?.displayString).toContain("formatUser");
  });
});
