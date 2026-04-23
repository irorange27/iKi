import * as promptAppDb from '../core/db/prompt_apps';
import { listSkills } from '../core/skills';
import type { ComposerInvocationPartData } from '../shared/chat/message_parts';
import {
  applyPromptAppSlashCommandTemplate,
  extractPromptAppSlashCommands,
  extractSkillSlashCommands,
  parseIncognitoArgument,
  parseSlashCommandDraft,
  toPromptAppComposerInvocationToken,
  toSkillComposerInvocationToken,
} from '../shared/chat/slash_commands';
import { normalizeAppLocale, type SupportedLocale } from '../shared/i18n/locale';

type NapCatSlashFeedbackKey =
  | 'desktopOnlyNew'
  | 'clearInvalidArgs'
  | 'threadCleared'
  | 'incognitoEnabled'
  | 'incognitoDisabled'
  | 'incognitoInvalidArgs'
  | 'skillNeedsRequest';

type NapCatSlashLocaleMessages = Record<NapCatSlashFeedbackKey, string>;

const NAPCAT_SLASH_MESSAGES: Record<SupportedLocale, NapCatSlashLocaleMessages> = {
  en: {
    desktopOnlyNew: '`/new` is only available in the desktop composer.',
    clearInvalidArgs: '`/clear` does not take extra text.',
    threadCleared: 'Context cleared. You can start a fresh task now.',
    incognitoEnabled: 'Incognito mode is now enabled.',
    incognitoDisabled: 'Incognito mode is now disabled.',
    incognitoInvalidArgs: 'Use `/incognito`, `/incognito on`, or `/incognito off`.',
    skillNeedsRequest: 'Add a request for {skill} before sending.',
  },
  'zh-CN': {
    desktopOnlyNew: '`/new` 目前只支持桌面端输入框。',
    clearInvalidArgs: '`/clear` 后面不需要额外内容。',
    threadCleared: '已清空上下文，现在可以直接开始新任务。',
    incognitoEnabled: '已开启无痕模式。',
    incognitoDisabled: '已关闭无痕模式。',
    incognitoInvalidArgs: '请使用 `/incognito`、`/incognito on` 或 `/incognito off`。',
    skillNeedsRequest: '发送前先补充要让 {skill} 处理的内容。',
  },
};

const translateNapCatSlash = (
  locale: string | null | undefined,
  key: NapCatSlashFeedbackKey,
  params?: Record<string, string>
): string => {
  const normalizedLocale = normalizeAppLocale(locale);
  const template = NAPCAT_SLASH_MESSAGES[normalizedLocale][key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, paramKey: string) => params[paramKey] ?? '');
};

const toComposerInvocationPartData = (tokens: ComposerInvocationPartData['tokens']) => {
  if (!tokens || tokens.length === 0) return undefined;
  return { tokens };
};

export type NapCatResolvedInboundMessage =
  | {
      kind: 'message';
      content: string;
      promptAppId?: string;
      skillMode?: 'manual' | 'auto';
      skillIds?: string[];
      composerInvocations?: ComposerInvocationPartData;
    }
  | {
      kind: 'feedback';
      feedback: string;
      nextIncognito?: boolean;
    }
  | {
      kind: 'reset-thread';
      feedback: string;
    };

export const resolveNapCatInboundSlashCommand = async (params: {
  draft: string;
  locale: string | null | undefined;
  currentIncognito: boolean;
}): Promise<NapCatResolvedInboundMessage> => {
  const parsed = parseSlashCommandDraft(params.draft);
  if (!parsed || !parsed.query) {
    return {
      kind: 'message',
      content: params.draft,
    };
  }

  if (parsed.query === 'new') {
    return {
      kind: 'feedback',
      feedback: translateNapCatSlash(params.locale, 'desktopOnlyNew'),
    };
  }

  if (parsed.query === 'clear') {
    if (parsed.argumentText.trim().length > 0) {
      return {
        kind: 'feedback',
        feedback: translateNapCatSlash(params.locale, 'clearInvalidArgs'),
      };
    }

    return {
      kind: 'reset-thread',
      feedback: translateNapCatSlash(params.locale, 'threadCleared'),
    };
  }

  if (parsed.query === 'incognito') {
    const nextIncognitoState = parseIncognitoArgument(parsed.argumentText);
    if (nextIncognitoState === null) {
      return {
        kind: 'feedback',
        feedback: translateNapCatSlash(params.locale, 'incognitoInvalidArgs'),
      };
    }

    const nextValue =
      nextIncognitoState === 'toggle' ? !params.currentIncognito : nextIncognitoState;

    return {
      kind: 'feedback',
      feedback: translateNapCatSlash(
        params.locale,
        nextValue ? 'incognitoEnabled' : 'incognitoDisabled'
      ),
      nextIncognito: nextValue,
    };
  }

  const promptAppCommand = extractPromptAppSlashCommands(promptAppDb.getEnabledPromptApps()).find(
    command => command.shortcut === parsed.query
  );
  if (promptAppCommand) {
    return {
      kind: 'message',
      content: applyPromptAppSlashCommandTemplate(
        promptAppCommand.promptTemplate,
        parsed.argumentText
      ),
      promptAppId: promptAppCommand.id,
      composerInvocations: toComposerInvocationPartData([
        toPromptAppComposerInvocationToken(promptAppCommand),
      ]),
    };
  }

  const skillCommand = extractSkillSlashCommands(await listSkills()).find(
    command => command.shortcut === parsed.query
  );
  if (!skillCommand) {
    return {
      kind: 'message',
      content: params.draft,
    };
  }

  const normalizedArgumentText = parsed.argumentText.trim();
  if (!normalizedArgumentText) {
    return {
      kind: 'feedback',
      feedback: translateNapCatSlash(params.locale, 'skillNeedsRequest', {
        skill: skillCommand.name,
      }),
    };
  }

  return {
    kind: 'message',
    content: normalizedArgumentText,
    skillMode: 'manual',
    skillIds: [skillCommand.skillId],
    composerInvocations: toComposerInvocationPartData([
      toSkillComposerInvocationToken(skillCommand),
    ]),
  };
};
