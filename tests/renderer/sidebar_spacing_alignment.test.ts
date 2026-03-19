import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SIDEBAR_VUE_PATH = resolve(process.cwd(), 'src/renderer/components/Sidebar.vue');
const CHAT_INPUT_VUE_PATH = resolve(process.cwd(), 'src/renderer/components/ChatInput.vue');

describe('sidebar/composer spacing alignment', () => {
  it('anchors sidebar bottom gap to the same composer spacing token', () => {
    const sidebarSource = readFileSync(SIDEBAR_VUE_PATH, 'utf8');
    const chatInputSource = readFileSync(CHAT_INPUT_VUE_PATH, 'utf8');

    expect(sidebarSource).toMatch(/marginBottom:\s*sidebar\.isCollapsed\.value\s*\?\s*'0px'\s*:\s*'var\(--chat-composer-padding,\s*10px\)'/);
    expect(chatInputSource).toMatch(/padding:\s*var\(--chat-composer-padding,\s*10px\);/);
  });
});
