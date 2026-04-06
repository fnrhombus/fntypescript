/**
 * Demo: decorators on standalone function declarations.
 *
 * TypeScript doesn't officially allow decorators on functions — only on
 * classes and class members. But the parser actually DOES parse them
 * (the AST is valid); it just emits a diagnostic error (TS1206).
 *
 * This example uses two plugins to unlock function decorators:
 *
 *   1. fntypescript Language Service plugin (editor-time)
 *      → Suppresses the TS1206 red squiggle in your IDE
 *
 *   2. ts-patch compiler transformer (build-time)
 *      → Suppresses TS1206 during `tspc` and rewrites the AST to emit
 *        decorator application code (e.g., `greet = log(greet)`)
 *
 * See plugin.ts for the implementation details.
 */

// ── Decorator functions ──────────────────────────────────────────────
//
// These are plain higher-order functions. A decorator `@foo` on a
// function `bar` is equivalent to `bar = foo(bar)`.
//
// The decorator receives the original function and returns a replacement.

/**
 * @log — wraps a function to print its name and arguments on each call.
 */
function log(target: Function) {
  return function (this: unknown, ...args: unknown[]) {
    console.log(`calling ${target.name}(${args.join(", ")})`);
    return target.apply(this, args);
  };
}

/**
 * @memoize — caches results by serialized arguments.
 * Subsequent calls with the same args return the cached value.
 */
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

// ── Decorated functions ──────────────────────────────────────────────
//
// With the plugin active:
//   - Your editor shows NO red squiggles on the @ decorators
//   - `tspc` compiles this to:
//       function greet(name) { ... }
//       greet = log(greet);

/** Every call to greet() will be logged to the console. */
@log
function greet(name: string): string {
  return `Hello, ${name}!`;
}

/** Recursive fibonacci with automatic memoization. */
@memoize
function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

/**
 * Stacked decorators: applied inside-out.
 *   - @log wraps first (closest to the function)
 *   - @memoize wraps the logged version
 *
 * Compiled output: expensiveCalculation = memoize(log(expensiveCalculation))
 */
@log
@memoize
function expensiveCalculation(x: number, y: number): number {
  return x ** y;
}

// ── Usage ────────────────────────────────────────────────────────────

console.log(greet("world"));
// => calling greet(world)
// => Hello, world!

console.log(fibonacci(10));
// => 55  (computed once, subsequent calls are cached)

console.log(expensiveCalculation(2, 10));
// => calling expensiveCalculation(2, 10)
// => 1024
