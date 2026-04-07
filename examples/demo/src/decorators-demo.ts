// DECORATOR DEMO
//
// This file demonstrates the two-runtime value of fntypescript.
//
// `@decorator` on standalone functions is a TypeScript error (TS1206) — the
// compiler rejects it. The function-decorators plugin suppresses TS1206 in
// both runtimes:
//
//   IDE:    compilerOptions.plugins loads the plugin into tsserver → no red squigglies
//   CI/CLI: `fntypescript check` runs the same plugin → `typecheck` passes
//
// PLUGIN EFFECT: Run `pnpm run typecheck:vanilla` (plain tsc) to see TS1206.
//               Run `pnpm run typecheck` (fntypescript) to see 0 errors.

function log(target: Function) {
  return function (this: unknown, ...args: unknown[]) {
    console.log(`calling ${target.name}(${args.join(", ")})`);
    return target.apply(this, args);
  };
}

function memoize(target: Function) {
  const cache = new Map<string, unknown>();
  return function (this: unknown, ...args: unknown[]) {
    const key = JSON.stringify(args);
    if (cache.has(key)) return cache.get(key);
    const result = target.apply(this, args);
    cache.set(key, result);
    return result;
  };
}

// PLUGIN EFFECT: TS1206 suppressed by plugin-function-decorators in both runtimes
@log
function greet(name: string): string {
  return `Hello, ${name}!`;
}

// PLUGIN EFFECT: TS1206 suppressed by plugin-function-decorators in both runtimes
@memoize
function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// PLUGIN EFFECT: TS1206 suppressed by plugin-function-decorators in both runtimes
@log
@memoize
function expensiveCalculation(x: number, y: number): number {
  return x ** y;
}

export { greet, fibonacci, expensiveCalculation };
