import * as promptAppDb from '@iki/backend/db/prompt_apps';
import { listSkills } from '@iki/backend/tools/skills';
import type { ComposerInvocationPartData } from '@iki/backend/chat/message_parts';
import {
  applyPromptAppSlashCommandTemplate,
  extractPromptAppSlashCommands,
  extractSkillSlashCommands,
  parseIncognitoArgument,
  parseSlashCommandDraft,
  toPromptAppComposerInvocationToken,
  toSkillComposerInvocationToken,
} from '@iki/backend/chat/slash_commands';
import { normalizeAppLocale, type SupportedLocale } from '@iki/backend/i18n/locale';

type NapCatSlashFeedbackKey =
  | 'startReady'
  | 'startNeedsSetup'
  | 'desktopOnlyNew'
  | 'clearInvalidArgs'
  | 'threadCleared'
  | 'incognitoEnabled'
  | 'incognitoDisabled'
  | 'incognitoInvalidArgs'
  | 'skillNeedsRequest'
  | 'helpHeader'
  | 'helpBuiltins'
  | 'helpSkills'
  | 'helpPromptApps'
  | 'helpNoAdditional';

type NapCatSlashLocaleMessages = Record<NapCatSlashFeedbackKey, string>;

const NAPCAT_SLASH_MESSAGES: Record<SupportedLocale, NapCatSlashLocaleMessages> = {
  en: {
    startReady:
      'iKi is ready here. Send a normal message, use `/start <request>` for a clear first task, or try a skill shortcut like `/frontend-dev ...`.',
    startNeedsSetup:
      'iKi is not ready on this bridge yet. In the desktop app, enable one working provider and make sure at least one model is available, then send `/start` again or just send a normal message.',
    desktopOnlyNew: '`/new` is only available in the desktop composer.',
    clearInvalidArgs: '`/clear` does not take extra text.',
    threadCleared: 'Context cleared. You can start a fresh task now.',
    incognitoEnabled: 'Incognito mode is now enabled.',
    incognitoDisabled: 'Incognito mode is now disabled.',
    incognitoInvalidArgs: 'Use `/incognito`, `/incognito on`, or `/incognito off`.',
    skillNeedsRequest: 'Add a request for {skill} before sending.',
    helpHeader: 'Available commands:',
    helpBuiltins: 'Built-in: /start, /clear, /incognito, /help',
    helpSkills: 'Skills: {skills}',
    helpPromptApps: 'Prompt apps: {apps}',
    helpNoAdditional: 'No additional commands installed.',
  },
  'zh-CN': {
    startReady:
      'iKi 在这里已经就绪。直接发普通消息即可；也可以用 `/start <内容>` 给出明确的第一项任务，或试试像 `/frontend-dev ...` 这样的 skill 快捷入口。',
    startNeedsSetup:
      '这个桥接还没准备好。请先在桌面端启用一个可用 Provider，并确认至少有一个模型可用，然后再发送 `/start`，或直接发普通消息。',
    desktopOnlyNew: '`/new` 目前只支持桌面端输入框。',
    clearInvalidArgs: '`/clear` 后面不需要额外内容。',
    threadCleared: '已清空上下文，现在可以直接开始新任务。',
    incognitoEnabled: '已开启无痕模式。',
    incognitoDisabled: '已关闭无痕模式。',
    incognitoInvalidArgs: '请使用 `/incognito`、`/incognito on` 或 `/incognito off`。',
    skillNeedsRequest: '发送前先补充要让 {skill} 处理的内容。',
    helpHeader: '可用指令：',
    helpBuiltins: '内置：/start、/clear、/incognito、/help',
    helpSkills: 'Skills：{skills}',
    helpPromptApps: '快捷指令：{apps}',
    helpNoAdditional: '没有额外的可用指令。',
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
  bridgeReady: boolean;
}): Promise<NapCatResolvedInboundMessage> => {
  const parsed = parseSlashCommandDraft(params.draft);
  if (!parsed || !parsed.query) {
    return {
      kind: 'message',
      content: params.draft,
    };
  }

  if (parsed.query === 'start') {
    const normalizedArgumentText = parsed.argumentText.trim();
    if (!params.bridgeReady) {
      return {
        kind: 'feedback',
        feedback: translateNapCatSlash(params.locale, 'startNeedsSetup'),
      };
    }

    if (!normalizedArgumentText) {
      return {
        kind: 'feedback',
        feedback: translateNapCatSlash(params.locale, 'startReady'),
      };
    }

    return {
      kind: 'message',
      content: normalizedArgumentText,
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

  if (parsed.query === 'help') {
    const promptApps = extractPromptAppSlashCommands(promptAppDb.getEnabledPromptApps());
    const skills = extractSkillSlashCommands(await listSkills());

    const lines: string[] = [translateNapCatSlash(params.locale, 'helpHeader')];
    lines.push(translateNapCatSlash(params.locale, 'helpBuiltins'));

    const skillShortcuts = skills.map(s => `/${s.shortcut}`).join(', ');
    if (skillShortcuts) {
      lines.push(translateNapCatSlash(params.locale, 'helpSkills', { skills: skillShortcuts }));
    }

    const appShortcuts = promptApps.map(a => `/${a.shortcut}`).join(', ');
    if (appShortcuts) {
      lines.push(translateNapCatSlash(params.locale, 'helpPromptApps', { apps: appShortcuts }));
    }

    if (!skillShortcuts && !appShortcuts) {
      lines.push(translateNapCatSlash(params.locale, 'helpNoAdditional'));
    }

    return {
      kind: 'feedback',
      feedback: lines.join('\n'),
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
