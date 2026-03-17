import hljs from 'highlight.js/lib/common';
import 'highlight.js/styles/atom-one-dark.css';

type MarkdownToken = { info?: string; content?: string };
type MarkdownFenceRenderer = (
  tokens: MarkdownToken[],
  idx: number,
  options: unknown,
  env: unknown,
  self: unknown
) => string;

type MarkdownPlugin = (md: {
  renderer: {
    rules: {
      fence?: MarkdownFenceRenderer;
      [key: string]: MarkdownFenceRenderer | undefined;
    };
  };
  utils: {
    escapeHtml: (value: string) => string;
  };
}) => void;

type MarkdownHighlightResult = {
  html: string;
  displayLanguage: string;
  languageClass: string;
};

const normalizeLanguage = (value: string): string => value.trim().toLowerCase();

const sanitizeLanguageClass = (value: string): string => value.replace(/[^a-z0-9_-]/gi, '');

const highlightCode = (
  source: string,
  languageHint: string,
  escapeHtml: (value: string) => string
): MarkdownHighlightResult => {
  const code = source || '';
  const hint = normalizeLanguage(languageHint);
  const safeHintClass = sanitizeLanguageClass(hint);
  const fallback: MarkdownHighlightResult = {
    html: escapeHtml(code),
    displayLanguage: hint || 'code',
    languageClass: safeHintClass || 'text',
  };

  if (!code.trim()) return fallback;

  try {
    if (hint && hljs.getLanguage(hint)) {
      return {
        html: hljs.highlight(code, { language: hint, ignoreIllegals: true }).value,
        displayLanguage: hint,
        languageClass: sanitizeLanguageClass(hint) || 'text',
      };
    }

    const autoResult = hljs.highlightAuto(code);
    const detected = normalizeLanguage(autoResult.language || '');
    const safeDetected = sanitizeLanguageClass(detected);

    return {
      html: autoResult.value || fallback.html,
      displayLanguage: hint || safeDetected || 'code',
      languageClass: safeDetected || safeHintClass || 'text',
    };
  } catch {
    return fallback;
  }
};

export const markdownCodeBlockPlugin: MarkdownPlugin = md => {
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx];
    const rawInfo = typeof token?.info === 'string' ? token.info.trim() : '';
    const languageHint = rawInfo.split(/\s+/).filter(Boolean)[0] || '';
    const sourceRaw = typeof token?.content === 'string' ? token.content : '';
    const source = sourceRaw.replace(/^\n+/, '').replace(/\n+$/, '');
    const { html, displayLanguage, languageClass } = highlightCode(
      source,
      languageHint,
      md.utils.escapeHtml
    );
    const escapedLanguage = md.utils.escapeHtml(displayLanguage || 'code');
    const codeClass = md.utils.escapeHtml(languageClass || 'text');
    const renderedFence = `<pre><code class="hljs language-${codeClass}">${html}</code></pre>`;

    return `<div class="md-code-block"><div class="md-code-header"><span class="md-code-lang">${escapedLanguage}</span><button type="button" class="md-code-copy-btn" aria-label="Copy code" title="Copy code"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg></button></div>${renderedFence}</div>`;
  };
};

