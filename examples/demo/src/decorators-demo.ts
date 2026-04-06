// DECORATOR DEMO
//
// NOTE: The @decorator syntax on standalone functions causes TS1206 errors
// at compile time. The Language Service plugin suppresses these in your editor,
// but tsc sees them during build. Each @decorator line below has a
// // @ts-expect-error comment to keep the build clean.
//
// With the function-decorators plugin active:
//   - No TS1206 red squiggle on the @log decorator below
//   - Hover over @log to see normal decorator hover info

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

// @ts-expect-error TS1206: decorators on standalone functions — suppressed by plugin in editor
@log
function greet(name: string): string {
  return `Hello, ${name}!`;
}

// @ts-expect-error TS1206: decorators on standalone functions — suppressed by plugin in editor
@memoize
function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

// @ts-expect-error TS1206: decorators on standalone functions — suppressed by plugin in editor
@log
@memoize
function expensiveCalculation(x: number, y: number): number {
  return x ** y;
}

export { greet, fibonacci, expensiveCalculation };
