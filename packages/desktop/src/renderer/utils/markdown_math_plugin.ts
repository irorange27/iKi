import katex from 'katex';
import 'katex/dist/katex.min.css';

import type {
  EscapeHtml,
  MarkdownBlockRule,
  MarkdownCoreWithRulers,
  MarkdownInlineRule,
  MarkdownInlineState,
  MarkdownPlugin,
} from './markdown_plugin_contract';

/**
 * Markdown-it math support for rendered message content.
 *
 * Providers emit math in whichever dialect they were trained on, so the plugin
 * accepts both common families and typesets them with KaTeX:
 *   - `$...$` inline and `$$...$$` display (OpenAI-style)
 *   - `\(...\)` inline and `\[...\]` display (LaTeX-style)
 *
 * Delimiters are matched against the raw source before markdown escaping runs,
 * which keeps every LaTeX backslash intact while `\$` still escapes a literal
 * dollar. Malformed math never swallows content: it falls back to the raw
 * source in a `<code>` element.
 */

type Delimiter = {
  open: string;
  close: string;
  currencyGuard: boolean;
};

type DelimiterMatch = {
  content: string;
  end: number;
};

// Order matters: `$$` must be tried before `$`.
const INLINE_DELIMITERS: Array<Delimiter & { tokenType: 'math_inline' | 'math_display' }> = [
  { open: '$$', close: '$$', currencyGuard: false, tokenType: 'math_display' },
  { open: '$', close: '$', currencyGuard: true, tokenType: 'math_inline' },
  { open: '\\(', close: '\\)', currencyGuard: false, tokenType: 'math_inline' },
  { open: '\\[', close: '\\]', currencyGuard: false, tokenType: 'math_display' },
];

const BLOCK_DELIMITERS: Delimiter[] = [
  { open: '$$', close: '$$', currencyGuard: false },
  { open: '\\[', close: '\\]', currencyGuard: false },
];

const isBlank = (value: string): boolean => value.trim().length === 0;

const isDigit = (value: string | undefined): boolean => value !== undefined && /[0-9]/.test(value);

// Find the closing delimiter, skipping escaped characters so `\$` and `\\)`
// stay inside the formula, and refusing to span an inline code span.
const findCloseIndex = (src: string, from: number, posMax: number, close: string): number => {
  let index = from;
  while (index < posMax) {
    const char = src[index];
    if (char === '`') return -1;
    if (src.startsWith(close, index) && src[index - 1] !== '\\') return index;
    index += char === '\\' ? 2 : 1;
  }
  return -1;
};

const isValidInlineContent = (
  content: string,
  currencyGuard: boolean,
  charAfterClose: string | undefined
): boolean => {
  if (isBlank(content)) return false;
  // Require the delimiters to hug the formula: "$ 5 $" is prose, not math.
  if (/\s/.test(content[0]) || /\s/.test(content[content.length - 1])) return false;
  // Mirrors KaTeX auto-render's currency heuristic: "costs $5 and $6" is money.
  if (currencyGuard && isDigit(charAfterClose)) return false;
  return true;
};

const renderKatex = (tex: string, displayMode: boolean): string | null => {
  try {
    return katex.renderToString(tex, {
      displayMode,
      throwOnError: true,
      strict: 'ignore',
      trust: false,
      // MathML next to the HTML keeps formulas available to screen readers.
      output: 'htmlAndMathml',
    });
  } catch {
    return null;
  }
};

const fallbackHtml = (tex: string, escapeHtml: EscapeHtml): string =>
  `<code class="md-math-fallback">${escapeHtml(tex)}</code>`;

const inlineMathHtml = (tex: string, escapeHtml: EscapeHtml): string =>
  renderKatex(tex, false) ?? fallbackHtml(tex, escapeHtml);

const displayMathHtml = (tex: string, escapeHtml: EscapeHtml, tag: 'span' | 'div'): string => {
  const html = renderKatex(tex, true);
  const className = tag === 'div' ? 'md-math-block' : 'md-math-display';
  return `<${tag} class="${className}${html ? '' : ' is-fallback'}">${html ?? fallbackHtml(tex, escapeHtml)}</${tag}>`;
};

const matchInlineDelimiter = (
  state: MarkdownInlineState,
  delimiter: Delimiter
): DelimiterMatch | null => {
  const { src, pos, posMax } = state;
  if (!src.startsWith(delimiter.open, pos)) return null;

  const contentStart = pos + delimiter.open.length;
  const closeIndex = findCloseIndex(src, contentStart, posMax, delimiter.close);
  if (closeIndex < 0) return null;

  const content = src.slice(contentStart, closeIndex);
  const end = closeIndex + delimiter.close.length;
  if (!isValidInlineContent(content, delimiter.currencyGuard, src[end])) return null;

  return { content, end };
};

const inlineMath: MarkdownInlineRule = (state, silent) => {
  for (const delimiter of INLINE_DELIMITERS) {
    const match = matchInlineDelimiter(state, delimiter);
    if (!match) continue;

    if (silent) {
      // `skipToken` calls rules in validation mode and requires a cursor move.
      state.pos = match.end;
      return true;
    }

    const token = state.push(delimiter.tokenType, 'span', 0);
    token.content = match.content;
    token.markup = delimiter.open;
    state.pos = match.end;
    return true;
  }
  return false;
};

const blockMath: MarkdownBlockRule = (state, startLine, endLine, silent) => {
  const lineStart = state.bMarks[startLine] + state.tShift[startLine];
  const lineEnd = state.eMarks[startLine];
  const delimiter = BLOCK_DELIMITERS.find(entry => state.src.startsWith(entry.open, lineStart));
  if (!delimiter) return false;

  const firstLine = state.src.slice(lineStart + delimiter.open.length, lineEnd);
  const bodyLines: string[] = [];
  let closeLine = -1;

  const sameLineClose = findCloseIndex(firstLine, 0, firstLine.length, delimiter.close);
  if (sameLineClose >= 0) {
    // Only a trailing-whitespace close is safe here: anything else on the line
    // would be dropped, so leave the block unmatched and render it as text.
    if (!isBlank(firstLine.slice(sameLineClose + delimiter.close.length))) return false;
    bodyLines.push(firstLine.slice(0, sameLineClose));
    closeLine = startLine;
  } else {
    bodyLines.push(firstLine);
    for (let line = startLine + 1; line < endLine; line++) {
      const rawLine = state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
      const closeIndex = findCloseIndex(rawLine, 0, rawLine.length, delimiter.close);
      if (closeIndex < 0) {
        bodyLines.push(rawLine);
        continue;
      }
      if (!isBlank(rawLine.slice(closeIndex + delimiter.close.length))) return false;
      bodyLines.push(rawLine.slice(0, closeIndex));
      closeLine = line;
      break;
    }
  }

  if (closeLine < 0) return false;

  const content = bodyLines.join('\n').trim();
  if (!content) return false;
  if (silent) return true;

  const token = state.push('math_block', 'div', 0);
  token.block = true;
  token.content = content;
  token.markup = delimiter.open;
  state.line = closeLine + 1;
  return true;
};

export const markdownMathPlugin: MarkdownPlugin<MarkdownCoreWithRulers> = md => {
  // Registered before `escape` so `\(` / `\[` are read as math delimiters
  // instead of being unescaped into literal brackets.
  md.inline.ruler.before('escape', 'math_inline', inlineMath);
  md.block.ruler.before('fence', 'math_block', blockMath, {
    alt: ['paragraph', 'reference', 'blockquote', 'list'],
  });

  // Escape through the markdown-it instance, matching the code-block plugin.
  const escapeHtml = md.utils.escapeHtml;

  // `content` is optional on the shared token type; the rules above always set
  // it, so the fallback is unreachable but keeps the contract honest.
  md.renderer.rules.math_inline = (tokens, idx) =>
    inlineMathHtml(tokens[idx].content ?? '', escapeHtml);

  md.renderer.rules.math_display = (tokens, idx) =>
    displayMathHtml(tokens[idx].content ?? '', escapeHtml, 'span');

  md.renderer.rules.math_block = (tokens, idx) =>
    displayMathHtml(tokens[idx].content ?? '', escapeHtml, 'div');
};
