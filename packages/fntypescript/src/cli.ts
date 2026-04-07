#!/usr/bin/env node
import * as ts from "typescript";
import * as process from "node:process";
import { check } from "./check.js";

function parseArgs(argv: string[]): { project: string | undefined; help: boolean } {
  let project: string | undefined;
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--project" || arg === "-p") {
      project = argv[++i];
    } else if (arg?.startsWith("--project=")) {
      project = arg.slice("--project=".length);
    }
  }

  return { project, help };
}

function printHelp(): void {
  console.error("Usage: fntypescript check [--project <tsconfig>]");
  console.error("");
  console.error("Options:");
  console.error("  -p, --project <path>  Path to tsconfig.json (default: ./tsconfig.json)");
  console.error("  -h, --help            Show this help message");
}

const args = process.argv.slice(2);

// The first positional arg should be "check"; skip it
const rest = args[0] === "check" ? args.slice(1) : args;

const { project, help } = parseArgs(rest);

if (help) {
  printHelp();
  process.exit(0);
}

let result;
try {
  result = check({ project });
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`fntypescript: ${message}`);
  process.exit(2);
}

if (result.diagnostics.length > 0) {
  const host: ts.FormatDiagnosticsHost = {
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => "\n",
    getCanonicalFileName: (f) => f,
  };
  const formatted = process.stderr.isTTY
    ? ts.formatDiagnosticsWithColorAndContext(result.diagnostics, host)
    : ts.formatDiagnostics(result.diagnostics, host);
  process.stderr.write(formatted);
}

process.exit(result.exitCode);
