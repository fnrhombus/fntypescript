// PLUGIN EFFECT: inside css`` templates, the "styled-completions" plugin
// offers completions for CSS properties (display, color, margin, etc.)
// Try pressing Ctrl+Space after the opening backtick.

declare function css(strings: TemplateStringsArray, ...values: unknown[]): string;

const buttonStyles = css`
  display: flex;
  padding: 8px 16px;
`;

export { buttonStyles };
