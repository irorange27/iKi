import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const VARIABLES_CSS_PATH = resolve(process.cwd(), 'src/renderer/assets/styles/variables.css');
const CHAT_INPUT_VUE_PATH = resolve(process.cwd(), 'src/renderer/components/ChatInput.vue');
const CHAT_COMPOSER_ACTIONS_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/ChatComposerActions.vue'
);
const CHAT_MESSAGE_ITEM_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/chat/ChatMessageItem.vue'
);
const CHAT_MESSAGE_PARTS_VUE_PATH = resolve(
  process.cwd(),
  'src/renderer/components/chat/ChatMessageParts.vue'
);

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
    expect(variablesSource).toMatch(
      /\[data-theme='light'\][\s\S]*--theme-chat-user-bubble-radius:\s*28px 10px 28px 28px;/i
    );
  });

  it('routes composer and outgoing bubble styles through semantic theme vars', () => {
    const chatInputSource = readFileSync(CHAT_INPUT_VUE_PATH, 'utf8');
    const chatComposerActionsSource = readFileSync(CHAT_COMPOSER_ACTIONS_VUE_PATH, 'utf8');
    const chatMessageItemSource = readFileSync(CHAT_MESSAGE_ITEM_VUE_PATH, 'utf8');
    const chatMessagePartsSource = readFileSync(CHAT_MESSAGE_PARTS_VUE_PATH, 'utf8');

    expect(chatInputSource).toMatch(/border-color:\s*var\(--chat-composer-border-color\);/);
    expect(chatInputSource).toMatch(/background:\s*var\(--chat-composer-background\);/);
    expect(chatInputSource).toMatch(/box-shadow:\s*var\(--chat-composer-shadow\);/);
    expect(chatInputSource).toMatch(/backdrop-filter:\s*var\(--chat-composer-backdrop-filter\);/);
    expect(chatInputSource).toMatch(
      /border-top-color:\s*var\(--chat-composer-toolbar-border-color\);/
    );
    expect(chatInputSource).toMatch(/background:\s*var\(--chat-composer-toolbar-background\);/);
    expect(chatComposerActionsSource).toMatch(
      /border:\s*1px solid var\(--chat-composer-control-border-color\);/
    );
    expect(chatComposerActionsSource).toMatch(
      /background:\s*var\(--chat-composer-control-background\);/
    );
    expect(chatComposerActionsSource).toMatch(
      /border-color:\s*var\(--chat-composer-control-hover-border-color\);/
    );
    expect(chatComposerActionsSource).toMatch(
      /border-color:\s*var\(--chat-composer-control-disabled-border-color\);/
    );
    expect(chatComposerActionsSource).toMatch(/speech-btn-unavailable/);

    expect(chatMessageItemSource).toMatch(/background:\s*var\(--chat-user-bubble-background\);/);
    expect(chatMessageItemSource).toMatch(
      /border:\s*1px solid var\(--chat-user-bubble-border-color\);/
    );
    expect(chatMessageItemSource).toMatch(
      /border-radius:\s*var\(--chat-user-bubble-radius,\s*28px\);/
    );
    expect(chatMessagePartsSource).toMatch(/color:\s*var\(--chat-user-bubble-text\);/);
  });
});
