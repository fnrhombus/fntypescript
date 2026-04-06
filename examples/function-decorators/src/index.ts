/**
 * Demo: decorators on standalone functions.
 *
 * With the allow-function-decorators plugin loaded, TypeScript's
 * language service won't flag these as errors in your editor.
 *
 * Note: tsc itself still emits TS1206 at build time (plugins only
 * run in the language service, not the compiler). This is purely
 * an editor-time enhancement.
 */

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

// With the plugin active, your editor won't show TS1206 here:

@log
function greet(name: string): string {
  return `Hello, ${name}!`;
}

@memoize
function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

@log
@memoize
function expensiveCalculation(x: number, y: number): number {
  return x ** y;
}
