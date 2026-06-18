import {
  isDynamicToolPart,
  isObjectRecord,
  isTextPart,
  type TextPart,
  type UiMessagePart,
} from '@iki/backend/chat/message_parts';

export const buildStreamingTextParts = (parts: UiMessagePart[], delta: string): UiMessagePart[] => {
  const nextParts = [...parts];
  const lastPart = nextParts[nextParts.length - 1];
  const shouldAppendToLast = isTextPart(lastPart) && lastPart.state === 'streaming';

  if (shouldAppendToLast) {
    const textPartIndex = nextParts.length - 1;
    const textPart = nextParts[textPartIndex] as TextPart;
    const previousText = textPart.text || '';
    nextParts[textPartIndex] = {
      ...textPart,
      text: `${previousText}${delta}`,
      state: 'streaming',
    };
  } else {
    const newPart: TextPart = {
      type: 'text',
      text: delta,
      state: 'streaming',
    };
    nextParts.push(newPart);
  }

  return nextParts;
};

const normalizeTextForToolDedup = (value: string): string => value.replace(/\s+/g, ' ').trim();

const isToolLikePart = (part: UiMessagePart): boolean => {
  if (isDynamicToolPart(part)) return true;
  return isObjectRecord(part) && typeof part.type === 'string' && part.type.startsWith('tool-');
};

export const dedupeToolBridgedRepeatedTextParts = (parts: UiMessagePart[]): UiMessagePart[] => {
  if (parts.length < 3) return parts;

  const latestIndexByText = new Map<string, number>();
  const removedTextIndices = new Set<number>();

  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!isTextPart(part)) continue;

    const normalizedText = normalizeTextForToolDedup(part.text);
    if (!normalizedText) continue;

    const previousIndex = latestIndexByText.get(normalizedText);
    if (previousIndex !== undefined && previousIndex < index) {
      const between = parts.slice(previousIndex + 1, index);
      const hasToolBetween = between.some(isToolLikePart);
      const hasMeaningfulTextBetween = between.some(
        entry => isTextPart(entry) && normalizeTextForToolDedup(entry.text).length > 0
      );

      if (hasToolBetween && !hasMeaningfulTextBetween) {
        removedTextIndices.add(previousIndex);
      }
    }

    latestIndexByText.set(normalizedText, index);
  }

  if (removedTextIndices.size === 0) return parts;

  return parts.filter((part, index) => !(removedTextIndices.has(index) && isTextPart(part)));
};

export const finalizeTextParts = (
  parts: UiMessagePart[],
  fullText: string,
  streamedText: string
): { parts: UiMessagePart[]; hasStreamingTextPart: boolean; appendedText?: string } => {
  const nextParts = [...parts];
  const textPartIndices = nextParts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => isTextPart(part))
    .map(({ index }) => index);

  const existingTextPart =
    textPartIndices.length > 0
      ? (nextParts[textPartIndices[textPartIndices.length - 1]] as TextPart)
      : undefined;
  const existingStreamed = existingTextPart ? existingTextPart.text : '';

  const finalText = fullText.length > 0 ? fullText : streamedText || existingStreamed;
  let hasStreamingTextPart = false;

  for (const index of textPartIndices) {
    const part = nextParts[index] as TextPart;
    if (part.state === 'streaming') {
      hasStreamingTextPart = true;
      nextParts[index] = {
        ...part,
        state: 'done',
      };
    }
  }

  if (textPartIndices.length === 0 && finalText) {
    const newPart: TextPart = {
      type: 'text',
      text: finalText,
      state: 'done',
    };
    nextParts.push(newPart);
    return { parts: nextParts, hasStreamingTextPart, appendedText: finalText };
  }

  if (!hasStreamingTextPart && finalText && !existingStreamed) {
    const newPart: TextPart = {
      type: 'text',
      text: finalText,
      state: 'done',
    };
    nextParts.push(newPart);
    return { parts: nextParts, hasStreamingTextPart, appendedText: finalText };
  }

  return { parts: nextParts, hasStreamingTextPart };
};

export const hasRenderableContent = (parts: UiMessagePart[]): boolean =>
  parts.some(part => (isTextPart(part) ? part.text.trim().length > 0 : true));
