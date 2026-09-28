/**
 * The markdown-it surface the renderer's markdown plugins share.
 *
 * markdown-it 14 ships no type declarations of its own, so each plugin has to
 * describe the slice of the instance it touches. Describing the same instance
 * twice is how the `self`/`utils` shape drifted apart (see
 * `MarkdownRenderRule`), so it is described once, here, and both plugins import
 * it. Keep additions structural: these types stand in for a library that has
 * none, and nothing here may require markdown-it at runtime or type level.
 */

export type EscapeHtml = (value: string) => string;

export type MarkdownToken = {
  content?: string;
  markup?: string;
  info?: string;
  block?: boolean;
};

// ponytail: `utils` hangs off the MarkdownIt instance, never off the Renderer
// that a render rule receives as its fifth argument — `md.utils.escapeHtml` is
// the only correct source. markdown-it v13 did expose it as `self.utils`, and
// the third-party plugin examples written against it are still what search
// surfaces first, so the wrong shape keeps getting copied in. `self` is typed
// `unknown` on purpose: the mistake then fails at type-check instead of throwing
// on every rendered message.
export type MarkdownRenderRule = (
  tokens: MarkdownToken[],
  idx: number,
  options: unknown,
  env: unknown,
  self: unknown
) => string;

/** The slice of a rule's state that a local plugin reads or writes. */
export type MarkdownInlineState = {
  src: string;
  pos: number;
  posMax: number;
  push: (type: string, tag: string, nesting: number) => MarkdownToken;
};

export type MarkdownBlockState = {
  src: string;
  bMarks: number[];
  eMarks: number[];
  tShift: number[];
  line: number;
  push: (type: string, tag: string, nesting: number) => MarkdownToken;
};

export type MarkdownInlineRule = (state: MarkdownInlineState, silent: boolean) => boolean;

export type MarkdownBlockRule = (
  state: MarkdownBlockState,
  startLine: number,
  endLine: number,
  silent: boolean
) => boolean;

/** What every plugin gets: token rendering plus escaping. */
export type MarkdownCore = {
  utils: { escapeHtml: EscapeHtml };
  renderer: { rules: Record<string, MarkdownRenderRule | undefined> };
};

/** Plugins that add a tokenizer rule also need a ruler to register it on. */
export type MarkdownCoreWithRulers = MarkdownCore & {
  inline: {
    ruler: { before: (anchor: string, name: string, rule: MarkdownInlineRule) => void };
  };
  block: {
    ruler: {
      before: (
        anchor: string,
        name: string,
        rule: MarkdownBlockRule,
        options?: { alt: string[] }
      ) => void;
    };
  };
};

export type MarkdownPlugin<Host = MarkdownCore> = (md: Host) => void;
