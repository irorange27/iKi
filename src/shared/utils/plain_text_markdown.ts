const normalizeCodeFenceLanguage = (rawLanguage: string): string => {
  const trimmed = rawLanguage.trim();
  if (!trimmed) return '';
  const firstToken = trimmed.split(/\s+/)[0] || '';
  return firstToken.replace(/[^a-zA-Z0-9#+._-]/g, '').slice(0, 24);
};

const stripInlineMarkdownMarkers = (input: string): string => {
  let text = input;

  for (let index = 0; index < 4; index += 1) {
    const next = text
      .replace(/\*\*([^*\n]+)\*\*/g, '$1')
      .replace(/__([^_\n]+)__/g, '$1')
      .replace(/~~([^~\n]+)~~/g, '$1')
      .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?:;]|$)/g, '$1$2')
      .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?:;]|$)/g, '$1$2');

    if (next === text) break;
    text = next;
  }

  return text;
};

export const renderMarkdownToPlainText = (markdown: string): string => {
  const source = markdown.replace(/\r\n/g, '\n').replace(/\t/g, '  ');
  if (!source.trim()) return '';

  const codeBlocks: string[] = [];
  let text = source.replace(/```([^\n`]*)\n([\s\S]*?)```/g, (_, rawLanguage, rawCode: string) => {
    const language = normalizeCodeFenceLanguage(String(rawLanguage || ''));
    const code = rawCode.replace(/\n+$/g, '').trimEnd();
    const token = `CODEBLOCKTOKEN${codeBlocks.length}`;
    const formattedCode = `${language ? `Code (${language}):\n` : ''}${code}`.trim();
    codeBlocks.push(formattedCode);
    return `\n${token}\n`;
  });

  text = text
    .replace(
      /!\[([^\]]*)\]\((https?:\/\/[^)\s]+(?:\([^)]+\)[^)\s]*)*)\)/g,
      (_, rawAlt: string, rawUrl: string) => {
        const alt = rawAlt.trim();
        const url = rawUrl.trim();
        return alt ? `${alt} (${url})` : url;
      }
    )
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+(?:\([^)]+\)[^)\s]*)*)\)/g,
      (_, rawLabel: string, rawUrl: string) => {
        const label = rawLabel.replace(/\s+/g, ' ').trim();
        const url = rawUrl.trim();
        return label && label !== url ? `${label} (${url})` : url;
      }
    )
    .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, '')
    .replace(/^(\s*)[-+*]\s+\[([ xX])\]\s+/gm, (_, indent: string, rawState: string) => {
      const state = rawState.toLowerCase() === 'x' ? 'x' : ' ';
      return `${indent}• [${state}] `;
    })
    .replace(/^(\s*)[-+*]\s+/gm, '$1• ')
    .replace(/^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/gm, '')
    .replace(/`([^`\n]+)`/g, '$1');

  text = stripInlineMarkdownMarkers(text);

  const normalizeTableLine = (line: string): string => {
    const trimmed = line.trim();
    if (!trimmed) return '';
    if (/^CODEBLOCKTOKEN\d+$/.test(trimmed)) return trimmed;

    const looksLikeTable =
      trimmed.includes('|') &&
      (trimmed.startsWith('|') || trimmed.endsWith('|') || trimmed.split('|').length >= 3);
    if (!looksLikeTable) return line.replace(/[ \t]+$/g, '');

    const rawCells = trimmed.split('|').map(cell => cell.trim());
    const cells = rawCells.filter((cell, index) => {
      if (index === 0 && cell === '') return false;
      if (index === rawCells.length - 1 && cell === '') return false;
      return true;
    });

    return cells.length >= 2 ? cells.join(' | ') : line.replace(/[ \t]+$/g, '');
  };

  const normalizedLines = text
    .replace(/\\([\\`*_{}\[\]()#+\-.!>|])/g, '$1')
    .split('\n')
    .map(normalizeTableLine);

  text = normalizedLines
    .filter((line, index, lines) => {
      if (line !== '') return true;
      const previous = lines[index - 1] || '';
      const next = lines[index + 1] || '';
      const isTableRow = (value: string) =>
        value.includes(' | ') && !/^CODEBLOCKTOKEN\d+$/.test(value.trim());
      return !(isTableRow(previous) && isTableRow(next));
    })
    .join('\n');

  for (const [index, block] of codeBlocks.entries()) {
    text = text.replace(new RegExp(`\\bCODEBLOCKTOKEN${index}\\b`, 'g'), block);
  }

  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
};
