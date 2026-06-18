import { computed, nextTick, onMounted, ref, watch, type Ref } from 'vue';

import type { PromptApp } from '@iki/core/types/chat';
import type { ElectronApi } from '@iki/core/types/electron_api';
import type { SkillSummary } from '@iki/core/types/skill';
import type {
  ComposerInvocationPartData,
  ComposerInvocationToken,
} from '@iki/core/chat/message_parts';
import {
  extractPromptAppSlashCommands,
  extractSkillSlashCommands,
  filterPromptAppSlashCommands,
  parseSlashCommandDraft,
  parseIncognitoArgument,
  applyPromptAppSlashCommandTemplate,
  toPromptAppComposerInvocationToken,
  toSkillComposerInvocationToken,
  type PromptAppSlashCommand,
} from '@iki/core/chat/slash_commands';
import type { ResolvedComposerSendRequest } from './useChatComposerSend';
import { createLogger } from '../logger';

type ComposerTextControl = HTMLInputElement | HTMLTextAreaElement;

type BuiltInSlashCommandId = 'new' | 'clear' | 'incognito' | 'init' | 'help';

type BuiltInSlashCommand = {
  id: `builtin:${BuiltInSlashCommandId}`;
  kind: 'builtin';
  shortcut: BuiltInSlashCommandId;
  name: string;
  description: string;
};

export type ComposerSlashCommand =
  | (PromptAppSlashCommand & { kind: 'prompt-app' })
  | {
      id: `skill:${string}`;
      kind: 'skill';
      shortcut: string;
      name: string;
      description: string;
      path?: string;
      skillId: string;
    }
  | BuiltInSlashCommand;

const slashCommandsLogger = createLogger({ module: 'chat_slash_commands' });
const PROMPT_APP_REFRESH_TTL_MS = 15_000;
const SKILLS_REFRESH_TTL_MS = 15_000;

const toPromptAppComposerCommands = (
  promptApps: readonly PromptApp[]
): Array<PromptAppSlashCommand & { kind: 'prompt-app' }> =>
  extractPromptAppSlashCommands(promptApps).map(command => ({
    ...command,
    kind: 'prompt-app' as const,
  }));

const toComposerInvocationToken = (
  command: ComposerSlashCommand
): ComposerInvocationToken | null => {
  if (command.kind === 'builtin') {
    return {
      id: command.id,
      kind: 'builtin',
      prefix: '/',
      label: command.shortcut,
      title: command.description || command.name,
    };
  }

  if (command.kind === 'prompt-app') {
    return toPromptAppComposerInvocationToken(command);
  }

  return toSkillComposerInvocationToken(command);
};

const toSelectedSkillComposerToken = (skill: SkillSummary): ComposerInvocationToken => ({
  id: `selected-skill:${skill.id}`,
  kind: 'skill',
  prefix: '$',
  label: skill.name,
  title: skill.description || skill.path || skill.id,
});

const buildComposerInvocationTokens = (params: {
  activeInvocation: ComposerSlashCommand | null;
  selectedSkills: readonly SkillSummary[];
}): ComposerInvocationToken[] => {
  const tokens: ComposerInvocationToken[] = [];
  const invocationToken = params.activeInvocation
    ? toComposerInvocationToken(params.activeInvocation)
    : null;

  if (invocationToken) {
    tokens.push(invocationToken);
  }

  if (params.activeInvocation?.kind === 'skill') {
    return tokens;
  }

  return [...tokens, ...params.selectedSkills.map(toSelectedSkillComposerToken)];
};

const toComposerInvocationPartData = (
  tokens: readonly ComposerInvocationToken[]
): ComposerInvocationPartData | undefined => {
  const persistedTokens = tokens.filter(token => token.kind !== 'builtin');
  if (persistedTokens.length === 0) return undefined;
  return { tokens: [...persistedTokens] };
};

export const useChatSlashCommands = (deps: {
  electronAPI: Pick<ElectronApi, 'promptApps' | 'skills' | 'workspaces'>;
  message: Ref<string>;
  inputRef: Ref<ComposerTextControl | null>;
  threadId: Ref<string | undefined>;
  currentIncognito: Ref<boolean>;
  selectedSkillIds: Ref<string[]>;
  onRequestNewChat: () => void;
  onRequestClearThread: () => void;
  onRequestIncognitoChange: (nextValue: boolean) => void;
  t: (key: string, params?: Record<string, unknown>) => string;
}) => {
  const enabledPromptApps = ref<PromptApp[]>([]);
  const availableSkills = ref<SkillSummary[]>([]);
  const activeInvocation = ref<ComposerSlashCommand | null>(null);
  const activeSuggestionIndex = ref(0);
  const dismissedQuery = ref<string | null>(null);
  const hasLoadedPromptApps = ref(false);
  const hasLoadedSkills = ref(false);
  const lastLoadedAt = ref(0);
  const lastLoadedSkillsAt = ref(0);
  let promptAppLoadPromise: Promise<void> | null = null;
  let skillsLoadPromise: Promise<void> | null = null;

  const builtInCommands = computed<BuiltInSlashCommand[]>(() => [
    {
      id: 'builtin:new',
      kind: 'builtin',
      shortcut: 'new',
      name: deps.t('chat.input.slash.new.name'),
      description: deps.t('chat.input.slash.new.description'),
    },
    {
      id: 'builtin:clear',
      kind: 'builtin',
      shortcut: 'clear',
      name: deps.t('chat.input.slash.clear.name'),
      description: deps.t('chat.input.slash.clear.description'),
    },
    {
      id: 'builtin:incognito',
      kind: 'builtin',
      shortcut: 'incognito',
      name: deps.t('chat.input.slash.incognito.name'),
      description: deps.t('chat.input.slash.incognito.description'),
    },
    {
      id: 'builtin:init',
      kind: 'builtin',
      shortcut: 'init',
      name: deps.t('chat.input.slash.init.name'),
      description: deps.t('chat.input.slash.init.description'),
    },
    {
      id: 'builtin:help',
      kind: 'builtin',
      shortcut: 'help',
      name: deps.t('chat.input.slash.help.name'),
      description: deps.t('chat.input.slash.help.description'),
    },
  ]);

  const loadEnabledPromptApps = async (options?: { force?: boolean }) => {
    const getEnabledPromptApps = deps.electronAPI.promptApps?.getEnabled;
    if (typeof getEnabledPromptApps !== 'function') {
      enabledPromptApps.value = [];
      hasLoadedPromptApps.value = true;
      lastLoadedAt.value = Date.now();
      return;
    }

    const isFresh =
      hasLoadedPromptApps.value && Date.now() - lastLoadedAt.value < PROMPT_APP_REFRESH_TTL_MS;
    if (!options?.force && isFresh) {
      return;
    }

    if (promptAppLoadPromise) {
      await promptAppLoadPromise;
      return;
    }

    promptAppLoadPromise = (async () => {
      try {
        const promptApps = await getEnabledPromptApps();
        enabledPromptApps.value = Array.isArray(promptApps) ? promptApps : [];
      } catch (error) {
        slashCommandsLogger.event({
          level: 'warn',
          event: 'chat.prompt_apps.load',
          outcome: 'failed',
          error,
        });
        enabledPromptApps.value = [];
      } finally {
        hasLoadedPromptApps.value = true;
        lastLoadedAt.value = Date.now();
        promptAppLoadPromise = null;
      }
    })();

    await promptAppLoadPromise;
  };

  const normalizeSkills = (input: unknown): SkillSummary[] => {
    if (!Array.isArray(input)) return [];
    const normalized: SkillSummary[] = [];
    for (const skill of input) {
      if (!skill || typeof skill !== 'object') continue;
      const { id, name, description, source, path } = skill as SkillSummary;
      if (typeof id !== 'string' || id.trim().length === 0) continue;
      if (typeof name !== 'string' || name.trim().length === 0) continue;

      normalized.push({
        id,
        name,
        description: typeof description === 'string' ? description : '',
        source: source === 'codex' || source === 'user' ? source : 'user',
        path: typeof path === 'string' ? path : undefined,
      });
    }
    return normalized;
  };

  const loadSkills = async (options?: { force?: boolean }) => {
    const listSkills = deps.electronAPI.skills?.list;
    if (typeof listSkills !== 'function') {
      availableSkills.value = [];
      hasLoadedSkills.value = true;
      lastLoadedSkillsAt.value = Date.now();
      return;
    }

    const isFresh =
      hasLoadedSkills.value && Date.now() - lastLoadedSkillsAt.value < SKILLS_REFRESH_TTL_MS;
    if (!options?.force && isFresh) {
      return;
    }

    if (skillsLoadPromise) {
      await skillsLoadPromise;
      return;
    }

    skillsLoadPromise = (async () => {
      try {
        const skills = await listSkills();
        availableSkills.value = normalizeSkills(skills);
      } catch (error) {
        slashCommandsLogger.event({
          level: 'warn',
          event: 'chat.skills.load',
          outcome: 'failed',
          error,
        });
        availableSkills.value = [];
      } finally {
        hasLoadedSkills.value = true;
        lastLoadedSkillsAt.value = Date.now();
        skillsLoadPromise = null;
      }
    })();

    await skillsLoadPromise;
  };

  const skillCommands = computed(() =>
    extractSkillSlashCommands(availableSkills.value).map(command => ({
      ...command,
      kind: 'skill' as const,
    }))
  );
  const promptAppCommands = computed(() => toPromptAppComposerCommands(enabledPromptApps.value));
  const slashCommands = computed<ComposerSlashCommand[]>(() => [
    ...builtInCommands.value,
    ...skillCommands.value,
    ...promptAppCommands.value,
  ]);
  const parsedDraft = computed(() => parseSlashCommandDraft(deps.message.value));
  const menuQuery = computed(() => {
    if (activeInvocation.value) return null;
    const parsed = parsedDraft.value;
    if (!parsed || parsed.hasArgumentSeparator) return null;
    return parsed.query;
  });
  const selectedSkills = computed<SkillSummary[]>(() => {
    const skillById = new Map(availableSkills.value.map(skill => [skill.id, skill] as const));
    return deps.selectedSkillIds.value.map(skillId => {
      const existing = skillById.get(skillId);
      if (existing) return existing;

      return {
        id: skillId,
        name: skillId.split(':').at(-1) ?? skillId,
        description: '',
        source: 'user',
        path: undefined,
      } satisfies SkillSummary;
    });
  });
  const composerInvocationTokens = computed(() =>
    buildComposerInvocationTokens({
      activeInvocation: activeInvocation.value,
      selectedSkills: selectedSkills.value,
    })
  );

  const suggestions = computed(() => {
    const query = menuQuery.value;
    if (query === null) return [] as ComposerSlashCommand[];
    return filterPromptAppSlashCommands(slashCommands.value, query);
  });

  const isMenuVisible = computed(() => {
    const query = menuQuery.value;
    if (query === null || dismissedQuery.value === query) return false;
    return suggestions.value.length > 0;
  });

  watch(
    menuQuery,
    nextQuery => {
      activeSuggestionIndex.value = 0;
      dismissedQuery.value = null;
      if (nextQuery !== null) {
        void loadSkills();
        void loadEnabledPromptApps();
      }
    },
    { immediate: true }
  );

  watch(suggestions, nextSuggestions => {
    if (nextSuggestions.length === 0) {
      activeSuggestionIndex.value = 0;
      return;
    }

    if (activeSuggestionIndex.value >= nextSuggestions.length) {
      activeSuggestionIndex.value = 0;
    }
  });

  onMounted(() => {
    void loadSkills();
    void loadEnabledPromptApps();
  });

  const setCursorToEnd = async () => {
    await nextTick();
    const input = deps.inputRef.value;
    if (!input) return;
    input.focus();
    const nextCursorPosition = deps.message.value.length;
    input.setSelectionRange?.(nextCursorPosition, nextCursorPosition);
  };

  const applySuggestion = (command: ComposerSlashCommand) => {
    const parsed = parseSlashCommandDraft(deps.message.value);
    activeInvocation.value = command;
    deps.message.value = parsed?.argumentText ?? '';
    activeSuggestionIndex.value = 0;
    dismissedQuery.value = command.shortcut;
    void setCursorToEnd();
  };

  const clearActiveInvocation = () => {
    activeInvocation.value = null;
    dismissedQuery.value = null;
  };

  const handleComposerKeydown = (event: KeyboardEvent): boolean => {
    if (!isMenuVisible.value || suggestions.value.length === 0) return false;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      activeSuggestionIndex.value = (activeSuggestionIndex.value + 1) % suggestions.value.length;
      return true;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      activeSuggestionIndex.value =
        (activeSuggestionIndex.value - 1 + suggestions.value.length) % suggestions.value.length;
      return true;
    }

    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      applySuggestion(suggestions.value[activeSuggestionIndex.value] ?? suggestions.value[0]);
      return true;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      dismissedQuery.value = menuQuery.value;
      return true;
    }

    return false;
  };

  const executeBuiltInCommand = async (
    command: BuiltInSlashCommand,
    argumentText: string
  ): Promise<ResolvedComposerSendRequest | null> => {
    const normalizedArgumentText = argumentText.trim();

    if (command.shortcut === 'new') {
      if (normalizedArgumentText.length > 0) {
        return {
          kind: 'skip',
          feedback: deps.t('chat.input.slash.new.invalidArgs'),
        };
      }
      deps.message.value = '';
      deps.onRequestNewChat();
      return {
        kind: 'skip',
        feedback: deps.t('chat.input.slash.new.executed'),
      };
    }

    if (command.shortcut === 'clear') {
      if (normalizedArgumentText.length > 0) {
        return {
          kind: 'skip',
          feedback: deps.t('chat.input.slash.clear.invalidArgs'),
        };
      }
      deps.message.value = '';
      deps.onRequestClearThread();
      return {
        kind: 'skip',
        feedback: deps.t('chat.input.slash.clear.executed'),
      };
    }

    if (command.shortcut === 'incognito') {
      const nextIncognitoState = parseIncognitoArgument(argumentText);
      if (nextIncognitoState === null) {
        return {
          kind: 'skip',
          feedback: deps.t('chat.input.slash.incognito.invalidArgs'),
        };
      }

      deps.message.value = '';
      deps.onRequestIncognitoChange(
        nextIncognitoState === 'toggle' ? !deps.currentIncognito.value : nextIncognitoState
      );
      return {
        kind: 'skip',
        feedback:
          nextIncognitoState === false
            ? deps.t('chat.input.slash.incognito.disabled')
            : nextIncognitoState === true
              ? deps.t('chat.input.slash.incognito.enabled')
              : deps.currentIncognito.value
                ? deps.t('chat.input.slash.incognito.disabled')
                : deps.t('chat.input.slash.incognito.enabled'),
      };
    }

    if (command.shortcut === 'help') {
      return {
        kind: 'skip',
        feedback: deps.t('chat.input.slash.help.executed'),
      };
    }

    if (command.shortcut === 'init') {
      const threadId = deps.threadId.value;
      if (!threadId) {
        return {
          kind: 'skip',
          feedback: deps.t('chat.input.slash.init.noWorkspace'),
        };
      }

      const result = await deps.electronAPI.workspaces.initAgentInstructions(threadId);
      if (!result.ok) {
        const isExists = result.error?.includes('already exists');
        return {
          kind: 'skip',
          feedback: isExists
            ? deps.t('chat.input.slash.init.exists')
            : deps.t('chat.input.slash.init.failed', { error: result.error ?? 'Unknown error' }),
        };
      }

      return {
        kind: 'skip',
        feedback: deps.t('chat.input.slash.init.created', { path: result.path ?? threadId }),
      };
    }

    return null;
  };

  const executeInvocationCommand = async (
    command: Extract<ComposerSlashCommand, { kind: 'skill' }>,
    argumentText: string
  ): Promise<ResolvedComposerSendRequest> => {
    const normalizedArgumentText = argumentText.trim();

    if (!normalizedArgumentText) {
      return {
        kind: 'skip',
        feedback: deps.t('chat.input.slash.skill.needsRequest', { skill: command.name }),
      };
    }

    return {
      kind: 'message',
      content: normalizedArgumentText,
      skillMode: 'manual',
      skillIds: [command.skillId],
      composerInvocations: toComposerInvocationPartData(
        buildComposerInvocationTokens({
          activeInvocation: command,
          selectedSkills: selectedSkills.value,
        })
      ),
      onCommitted: clearActiveInvocation,
    };
  };

  const executePromptAppInvocation = async (
    command: Extract<ComposerSlashCommand, { kind: 'prompt-app' }>,
    argumentText: string
  ): Promise<ResolvedComposerSendRequest> => ({
    kind: 'message',
    content: applyPromptAppSlashCommandTemplate(command.promptTemplate, argumentText),
    promptAppId: command.id,
    composerInvocations: toComposerInvocationPartData(
      buildComposerInvocationTokens({
        activeInvocation: command,
        selectedSkills: selectedSkills.value,
      })
    ),
    onCommitted: clearActiveInvocation,
  });

  const resolveSlashCommandSend = async (draft: string): Promise<ResolvedComposerSendRequest> => {
    const invocation = activeInvocation.value;
    if (invocation) {
      if (invocation.kind === 'builtin') {
        const executed = await executeBuiltInCommand(invocation, draft);
        if (executed?.kind === 'skip') {
          clearActiveInvocation();
        }
        return (
          executed ?? {
            kind: 'message',
            content: draft,
            composerInvocations: toComposerInvocationPartData(composerInvocationTokens.value),
          }
        );
      }

      if (invocation.kind === 'skill') {
        return await executeInvocationCommand(invocation, draft);
      }

      return await executePromptAppInvocation(invocation, draft);
    }

    await loadSkills({
      force:
        !hasLoadedSkills.value || Date.now() - lastLoadedSkillsAt.value >= SKILLS_REFRESH_TTL_MS,
    });
    await loadEnabledPromptApps({
      force:
        !hasLoadedPromptApps.value || Date.now() - lastLoadedAt.value >= PROMPT_APP_REFRESH_TTL_MS,
    });

    const parsed = parseSlashCommandDraft(draft);
    if (!parsed || !parsed.query) {
      return {
        kind: 'message',
        content: draft,
        composerInvocations: toComposerInvocationPartData(composerInvocationTokens.value),
      };
    }

    const builtInCommand = builtInCommands.value.find(command => command.shortcut === parsed.query);
    if (builtInCommand) {
      const executed = await executeBuiltInCommand(builtInCommand, parsed.argumentText);
      if (executed) return executed;
    }

    const skillCommand = skillCommands.value.find(command => command.shortcut === parsed.query);
    if (skillCommand) {
      return await executeInvocationCommand(skillCommand, parsed.argumentText);
    }

    const promptAppCommand = promptAppCommands.value.find(
      command => command.shortcut === parsed.query
    );
    if (!promptAppCommand) {
      return {
        kind: 'message',
        content: draft,
        composerInvocations: toComposerInvocationPartData(composerInvocationTokens.value),
      };
    }

    return {
      kind: 'message',
      content: applyPromptAppSlashCommandTemplate(
        promptAppCommand.promptTemplate,
        parsed.argumentText
      ),
      promptAppId: promptAppCommand.id,
      composerInvocations: toComposerInvocationPartData(
        buildComposerInvocationTokens({
          activeInvocation: promptAppCommand,
          selectedSkills: selectedSkills.value,
        })
      ),
    };
  };

  return {
    suggestions,
    activeSuggestionIndex,
    isMenuVisible,
    activeInvocation,
    selectedSkills,
    composerInvocationTokens,
    applySuggestion,
    clearActiveInvocation,
    handleComposerKeydown,
    resolveSlashCommandSend,
  };
};
