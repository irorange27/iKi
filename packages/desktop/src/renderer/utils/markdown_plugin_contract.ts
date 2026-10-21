

export type EscapeHtml = (value: string) => string;

export type MarkdownToken = {
  content?: string;
  markup?: string;
  info?: string;
  block?: boolean;
  meta?: Record<string, unknown>;
};

export type MarkdownRenderRule = (
  tokens: MarkdownToken[],
  idx: number,
  options: unknown,
  env: unknown,
  self: unknown
) => string;

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

export type MarkdownCore = {
  utils: { escapeHtml: EscapeHtml };
  renderer: { rules: Record<string, MarkdownRenderRule | undefined> };
};

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
