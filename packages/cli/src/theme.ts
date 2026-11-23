import { stdout as output } from 'node:process';
import type { EditorTheme, MarkdownTheme, SelectListTheme } from '@earendil-works/pi-tui';

const useColor = Boolean(output.isTTY) && !process.env.NO_COLOR;

const fg = (r: number, g: number, b: number) => (text: string) =>
  useColor ? `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m` : text;

const bg = (r: number, g: number, b: number) => (text: string) =>
  useColor ? `\x1b[48;2;${r};${g};${b}m${text}\x1b[49m` : text;

const wrapStyle = (open: string, close: string) => (text: string) =>
  useColor ? `${open}${text}${close}` : text;

// Truecolor palette aligned with pi's dark terminal theme.
export const cliTheme = {
  accent: fg(210, 128, 227),
  border: fg(124, 142, 240),
  borderAccent: fg(229, 133, 205),
  borderMuted: fg(110, 115, 141),
  text: fg(227, 228, 234),
  muted: fg(165, 168, 182),
  dim: fg(126, 130, 148),
  thinking: fg(156, 160, 176),
  success: fg(118, 219, 173),
  error: fg(235, 122, 108),
  warning: fg(229, 192, 123),
  link: fg(111, 140, 242),

  userBg: bg(38, 43, 74),
  selectedBg: bg(45, 52, 88),
  panelBg: bg(28, 30, 43),
  toolPendingBg: bg(47, 49, 58),
  toolSuccessBg: bg(33, 62, 52),
  toolErrorBg: bg(72, 35, 30),

  bold: wrapStyle('\x1b[1m', '\x1b[22m'),
  italic: wrapStyle('\x1b[3m', '\x1b[23m'),
  underline: wrapStyle('\x1b[4m', '\x1b[24m'),
  strikethrough: wrapStyle('\x1b[9m', '\x1b[29m'),
};

export const selectListTheme: SelectListTheme = {
  selectedPrefix: text => cliTheme.bold(cliTheme.borderAccent(text)),
  selectedText: text => cliTheme.selectedBg(cliTheme.bold(cliTheme.text(text))),
  description: text => cliTheme.dim(text),
  scrollInfo: text => cliTheme.dim(text),
  noMatch: text => cliTheme.dim(text),
};

export const createCliEditorTheme = (isBusy: () => boolean): EditorTheme => ({
  borderColor: text => (isBusy() ? cliTheme.borderMuted(text) : cliTheme.borderAccent(text)),
  selectList: selectListTheme,
});

export const cliMarkdownTheme: MarkdownTheme = {
  heading: text => cliTheme.bold(cliTheme.warning(text)),
  link: text => cliTheme.link(text),
  linkUrl: text => cliTheme.dim(text),
  code: text => cliTheme.accent(text),
  codeBlock: text => cliTheme.success(text),
  codeBlockBorder: text => cliTheme.dim(text),
  quote: text => cliTheme.muted(text),
  quoteBorder: text => cliTheme.dim(text),
  hr: text => cliTheme.dim(text),
  listBullet: text => cliTheme.accent(text),
  bold: text => cliTheme.bold(text),
  italic: text => cliTheme.italic(text),
  strikethrough: text => cliTheme.strikethrough(text),
  underline: text => cliTheme.underline(text),
};
