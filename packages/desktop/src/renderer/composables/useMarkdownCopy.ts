export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  if (!text) return false;

  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      return copied;
    } catch {
      return false;
    }
  }
};

export const useMarkdownCopy = () => {
  const handleMarkdownClick = async (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const copyButton = target.closest('.md-code-copy-btn') as HTMLButtonElement | null;
    if (!copyButton) return;

    const codeElement = copyButton.closest('.md-code-block')?.querySelector('pre code');
    const codeText = codeElement?.textContent ?? '';
    if (!codeText.trim()) return;

    const copied = await copyTextToClipboard(codeText);
    if (!copied) return;

    copyButton.dataset.copied = 'true';
    window.setTimeout(() => {
      delete copyButton.dataset.copied;
    }, 1200);
  };

  return {
    handleMarkdownClick,
  };
};
