import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import importPlugin from 'eslint-plugin-import';
import pluginVue from 'eslint-plugin-vue';
import vueParser from 'vue-eslint-parser';

export default tseslint.config(
  {
    ignores: [
      '**/*.js',
      '**/*.cjs',
      '**/*.mjs',
      'docs/**',
      'out/**',
      'node_modules/**',
      '**/dist/**',
      'packages/desktop/.vite/**',
      'packages/desktop/out/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  importPlugin.flatConfigs.recommended,
  importPlugin.flatConfigs.typescript,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2024,
      },
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: ['tsconfig.json', 'packages/*/tsconfig.json'],
        },
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          vars: 'all',
          args: 'after-used',
          caughtErrors: 'none',
          ignoreRestSiblings: true,
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      vue: pluginVue,
    },
    rules: {
      'vue/no-parsing-error': 'error',
    },
  },
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/src/**/*.vue'],
    ignores: ['**/i18n/catalogs/**'],
    rules: {
      'max-lines': [
        'error',
        {
          max: 800,
          skipBlankLines: false,
          skipComments: false,
        },
      ],
    },
  },
  {
    files: [
      'packages/desktop/src/renderer/components/ChatInput.vue',
      'packages/desktop/src/renderer/components/Sidebar.vue',
      'packages/desktop/src/renderer/components/chat/ChatMessageParts.vue',
      'packages/desktop/src/renderer/components/ChatModelSelector.vue',
      'packages/desktop/src/renderer/store/thread_session.ts',
      'packages/desktop/src/renderer/views/ChatView.vue',
    ],
    rules: {
      'max-lines': 'off',
    },
  }
);
