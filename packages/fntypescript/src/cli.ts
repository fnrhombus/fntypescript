#!/usr/bin/env node
import ts from "typescript";
import { check } from "./check.js";

function parseArgs(argv: string[]): { project?: string; help: boolean } {
  const args = argv.slice(2); // strip node + script path
  let project: string | undefined;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--project" || arg === "-p") {
      project = args[++i];
    } else if (arg?.startsWith("--project=")) {
      project = arg.slice("--project=".length);
    } else if (arg?.startsWith("-p=")) {
      project = arg.slice("-p=".length);
    }
  }

  return { project, help };
}

function printHelp(): void {
  process.stderr.write(
    [
      "Usage: fntypescript check [options]",
      "",
      "Options:",
      "  -p, --project <tsconfig>  Path to tsconfig.json (default: tsconfig.json)",
      "  -h, --help                Show this help message",
      "",
      "Exit codes:",
      "  0  No errors",
      "  1  Type errors found",
      "  2  Configuration error",
      "",
    ].join("\n"),
  );
}

function main(): void {
  // Strip the `check` sub-command if present (allows: fntypescript check -p ...)
  const argv =
    process.argv[2] === "check"
      ? ["", "", ...process.argv.slice(3)]
      : process.argv;

  const { project, help } = parseArgs(argv);

  if (help) {
    printHelp();
    process.exit(0);
    return;
  }

  let result;
  try {
    result = check({ project });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`error: ${message}\n`);
    process.exit(2);
    return; // unreachable but satisfies control flow
  }

  if (result.diagnostics.length > 0) {
    const host: ts.FormatDiagnosticsHost = {
      getCurrentDirectory: () => process.cwd(),
      getCanonicalFileName: (f) => f,
      getNewLine: () => "\n",
    };

    const formatted = process.stderr.isTTY
      ? ts.formatDiagnosticsWithColorAndContext(result.diagnostics, host)
      : ts.formatDiagnostics(result.diagnostics, host);

    process.stderr.write(formatted);
  }

  process.exit(result.exitCode);
}

main();
