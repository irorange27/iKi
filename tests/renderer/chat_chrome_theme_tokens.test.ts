import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const VARIABLES_CSS_PATH = resolve(process.cwd(), 'src/renderer/assets/styles/variables.css');
const CHAT_INPUT_VUE_PATH = resolve(process.cwd(), 'src/renderer/components/ChatInput.vue');
const CHAT_VIEW_VUE_PATH = resolve(process.cwd(), 'src/renderer/views/ChatView.vue');

describe('chat chrome theme tokens', () => {
  it('defines dedicated composer and user bubble tokens with light-theme overrides', () => {
    const variablesSource = readFileSync(VARIABLES_CSS_PATH, 'utf8');

    expect(variablesSource).toMatch(/--theme-chat-composer-background:/);
    expect(variablesSource).toMatch(/--chat-composer-border-color:/);
    expect(variablesSource).toMatch(/--chat-composer-background:/);
    expect(variablesSource).toMatch(/--chat-composer-toolbar-background:/);
    expect(variablesSource).toMatch(/--chat-composer-control-background:/);
    expect(variablesSource).toMatch(/--chat-composer-control-disabled-background:/);
    expect(variablesSource).toMatch(/--chat-composer-backdrop-filter:/);
    expect(variablesSource).toMatch(/--chat-user-bubble-background:/);
    expect(variablesSource).toMatch(/--chat-user-bubble-radius:/);
    expect(variablesSource).toMatch(
      /\[data-theme='light'\][\s\S]*--theme-chat-composer-background:[\s\S]*--theme-chat-user-bubble-background:/i
    );
  });

  it('routes composer and outgoing bubble styles through semantic theme vars', () => {
    const chatInputSource = readFileSync(CHAT_INPUT_VUE_PATH, 'utf8');
    const chatViewSource = readFileSync(CHAT_VIEW_VUE_PATH, 'utf8');

    expect(chatInputSource).toMatch(/border-color:\s*var\(--chat-composer-border-color\);/);
    expect(chatInputSource).toMatch(/background:\s*var\(--chat-composer-background\);/);
    expect(chatInputSource).toMatch(/box-shadow:\s*var\(--chat-composer-shadow\);/);
    expect(chatInputSource).toMatch(/backdrop-filter:\s*var\(--chat-composer-backdrop-filter\);/);
    expect(chatInputSource).toMatch(
      /border-top-color:\s*var\(--chat-composer-toolbar-border-color\);/
    );
    expect(chatInputSource).toMatch(/background:\s*var\(--chat-composer-toolbar-background\);/);
    expect(chatInputSource).toMatch(
      /border:\s*1px solid var\(--chat-composer-control-border-color\);/
    );
    expect(chatInputSource).toMatch(/background:\s*var\(--chat-composer-control-background\);/);
    expect(chatInputSource).toMatch(
      /border-color:\s*var\(--chat-composer-control-hover-border-color\);/
    );
    expect(chatInputSource).toMatch(
      /border-color:\s*var\(--chat-composer-control-disabled-border-color\);/
    );
    expect(chatInputSource).toMatch(/speech-btn-unavailable/);

    expect(chatViewSource).toMatch(/background:\s*var\(--chat-user-bubble-background\);/);
    expect(chatViewSource).toMatch(/border:\s*1px solid var\(--chat-user-bubble-border-color\);/);
    expect(chatViewSource).toMatch(/border-radius:\s*var\(--chat-user-bubble-radius,\s*28px\);/);
    expect(chatViewSource).toMatch(/color:\s*var\(--chat-user-bubble-text\);/);
  });
});
