import * as chatThreadDb from '../../../core/db/chat_thread';
import * as continuityDb from '../../../core/db/continuity';
import { extractTextFromMessageJson } from '../../../core/db/memory';
import { getAppConfig } from '../../../core/config';
import { createLogger } from '../../../core/logger';
import type {
  AssistantProfileRecord,
  ContinuityItemKind,
  ContinuityItemRecord,
} from '../../../shared/types/continuity';
import { normalizeWhitespace } from '../../../shared/utils/text';
import { getOrCreateActiveIdentityProfile } from '../identity/identity_service';
import { getIdentityBrainDocuments } from '../identity/identity_brain';

const continuityLogger = createLogger({ module: 'continuity_service' });
const EXPLICIT_EXTRACTOR_VERSION = 'continuity-explicit-v1';

type ContinuityMemoryPreview = {
  id: string;
  summary: string;
  score: number;
  updated_at?: string;
  tags?: string[];
  sourceMessageCount?: number;
};

export type ContinuityRetrievalPayload = {
  query: string;
  results: ContinuityMemoryPreview[];
  systemMessage: string;
};

const parseJsonStringArray = (value: string | null | undefined): string[] => {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is string => typeof entry === 'string')
      .map(entry => normalizeWhitespace(entry))
      .filter(Boolean);
  } catch {
    return [];
  }
};

const getContinuityConfig = () => {
  const config = getAppConfig()?.continuity;
  return {
    enabled: config?.enabled !== false,
    autoCaptureExplicitFacts: config?.autoCaptureExplicitFacts !== false,
    injectToSystemPrompt: config?.injectToSystemPrompt !== false,
    maxRetrievedItems: Math.max(1, Math.trunc(config?.maxRetrievedItems || 6)),
  };
};

const stringifyJson = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
};

const ensureActiveAssistantProfile = (): AssistantProfileRecord | null => {
  const identity = getOrCreateActiveIdentityProfile();
  if (!identity) return null;

  return continuityDb.upsertAssistantProfile({
    profile_id: identity.id,
    display_name: normalizeWhitespace(identity.name) || 'iKi',
    role_summary: normalizeWhitespace(identity.self_description),
    owner_display_name: normalizeWhitespace(identity.owner_name),
    tone_guidance: normalizeWhitespace(identity.tone_guidance),
    hard_boundaries_json: identity.boundaries,
    collaboration_style_json: identity.core_values,
    metadata_json: stringifyJson({
      legacyIdentityProfileId: identity.id,
      identityOwnerRoleDescription: identity.owner_role_description,
    }),
  });
};

const buildAssistantProfileSystemMessage = (profile: AssistantProfileRecord): string => {
  const boundaries = parseJsonStringArray(profile.hard_boundaries_json);
  const collaborationStyle = parseJsonStringArray(profile.collaboration_style_json);
  const brainDocuments = getIdentityBrainDocuments();
  const ikiNotes = normalizeWhitespace(brainDocuments.iki || '');

  return [
    'Assistant profile for iKi:',
    `- Name: ${profile.display_name}`,
    profile.role_summary ? `- Role: ${profile.role_summary}` : '',
    profile.owner_display_name ? `- Owner label: ${profile.owner_display_name}` : '',
    profile.tone_guidance ? `- Tone guidance: ${profile.tone_guidance}` : '',
    ...(collaborationStyle.length > 0
      ? ['- Collaboration style:', ...collaborationStyle.map(item => `  - ${item}`)]
      : []),
    ...(boundaries.length > 0 ? ['- Hard boundaries:', ...boundaries.map(item => `  - ${item}`)] : []),
    ikiNotes
      ? ['- Manual assistant note from brain/iki.md:', ikiNotes].join('\n')
      : '',
  ]
    .filter(Boolean)
    .join('\n');
};

const continuityKindLabel = (kind: ContinuityItemKind): string => {
  switch (kind) {
    case 'owner_fact':
      return 'owner fact';
    case 'preference':
      return 'preference';
    case 'boundary':
      return 'boundary';
    case 'project':
      return 'project';
    case 'person':
      return 'person';
    case 'workflow_rule':
      return 'workflow rule';
    case 'reference_note':
    default:
      return 'reference note';
  }
};

const toContinuityPreview = (item: ContinuityItemRecord & { score: number; evidence_count: number }): ContinuityMemoryPreview => ({
  id: item.id,
  summary: `${continuityKindLabel(item.kind)}: ${item.summary}`,
  score: item.score,
  updated_at: item.last_confirmed_at || item.updated_at,
  tags: ['continuity', item.kind, item.status],
  sourceMessageCount: item.evidence_count || undefined,
});

const buildContinuitySystemMessage = (results: ContinuityMemoryPreview[]): string => {
  if (!results.length) return '';
  return [
    'Durable continuity context (confirmed facts only; use only when relevant):',
    ...results.map(entry => {
      const score = Number.isFinite(entry.score) ? entry.score.toFixed(3) : '0.000';
      const dateText = entry.updated_at ? new Date(entry.updated_at).toLocaleDateString() : '';
      const tagText = Array.isArray(entry.tags) && entry.tags.length > 0 ? `[${entry.tags.join(', ')}] ` : '';
      return dateText
        ? `- (${score}, ${dateText}) ${tagText}${entry.summary}`
        : `- (${score}) ${tagText}${entry.summary}`;
    }),
  ].join('\n');
};

type ExplicitCapture = {
  kind: ContinuityItemKind;
  title: string;
  summary: string;
};

const cleanCapturedValue = (value: string): string =>
  normalizeWhitespace(value).replace(/[。.!?;；，,]+$/u, '').trim();

const extractExplicitContinuity = (content: string): ExplicitCapture[] => {
  const normalized = normalizeWhitespace(content);
  if (!normalized) return [];

  const captures: ExplicitCapture[] = [];
  const patterns: Array<{ regex: RegExp; map: (match: RegExpExecArray) => ExplicitCapture | null }> = [
    {
      regex: /\bmy name is\s+(.+)$/iu,
      map: match => {
        const value = cleanCapturedValue(match[1] || '');
        return value
          ? { kind: 'owner_fact', title: 'Owner name', summary: `The owner's name is ${value}.` }
          : null;
      },
    },
    {
      regex: /\bcall me\s+(.+)$/iu,
      map: match => {
        const value = cleanCapturedValue(match[1] || '');
        return value
          ? { kind: 'preference', title: 'Preferred address', summary: `Call the owner ${value}.` }
          : null;
      },
    },
    {
      regex: /\bi prefer\s+(.+)$/iu,
      map: match => {
        const value = cleanCapturedValue(match[1] || '');
        return value
          ? { kind: 'preference', title: 'Stated preference', summary: `The owner prefers ${value}.` }
          : null;
      },
    },
    {
      regex: /\bplease remember(?:\s+that)?\s+(.+)$/iu,
      map: match => {
        const value = cleanCapturedValue(match[1] || '');
        return value
          ? { kind: 'reference_note', title: 'Explicit memory request', summary: value }
          : null;
      },
    },
    {
      regex: /我的名字是(.+)$/u,
      map: match => {
        const value = cleanCapturedValue(match[1] || '');
        return value ? { kind: 'owner_fact', title: 'Owner name', summary: `The owner's name is ${value}.` } : null;
      },
    },
    {
      regex: /叫我(.+)$/u,
      map: match => {
        const value = cleanCapturedValue(match[1] || '');
        return value ? { kind: 'preference', title: 'Preferred address', summary: `Call the owner ${value}.` } : null;
      },
    },
    {
      regex: /我更喜欢(.+)$/u,
      map: match => {
        const value = cleanCapturedValue(match[1] || '');
        return value ? { kind: 'preference', title: 'Stated preference', summary: `The owner prefers ${value}.` } : null;
      },
    },
    {
      regex: /请记住(.+)$/u,
      map: match => {
        const value = cleanCapturedValue(match[1] || '');
        return value ? { kind: 'reference_note', title: 'Explicit memory request', summary: value } : null;
      },
    },
    {
      regex: /记住(.+)$/u,
      map: match => {
        const value = cleanCapturedValue(match[1] || '');
        return value ? { kind: 'reference_note', title: 'Explicit memory request', summary: value } : null;
      },
    },
  ];

  for (const pattern of patterns) {
    const match = pattern.regex.exec(normalized);
    if (!match) continue;
    const capture = pattern.map(match);
    if (!capture) continue;
    captures.push(capture);
  }

  return captures;
};

export const getAssistantProfileContextMessage = (): string => {
  const config = getContinuityConfig();
  if (!config.enabled || !config.injectToSystemPrompt) return '';
  const profile = ensureActiveAssistantProfile();
  if (!profile) return '';
  return buildAssistantProfileSystemMessage(profile);
};

export const retrieveRelevantContinuity = (query: string): ContinuityRetrievalPayload | null => {
  const config = getContinuityConfig();
  const normalizedQuery = normalizeWhitespace(query);
  if (!config.enabled || !config.injectToSystemPrompt || !normalizedQuery) return null;

  const profile = ensureActiveAssistantProfile();
  if (!profile) return null;

  const itemResults = continuityDb
    .searchContinuityItems({
      profileId: profile.profile_id,
      query: normalizedQuery,
      limit: config.maxRetrievedItems,
      statuses: ['confirmed'],
    })
    .map(toContinuityPreview);

  const results = [...itemResults].sort((a, b) => b.score - a.score).slice(0, config.maxRetrievedItems);

  if (!results.length) return null;

  continuityDb.touchContinuityItems(
    itemResults
      .map(entry => entry.id)
      .filter(id => results.some(result => result.id === id))
  );

  return {
    query: normalizedQuery,
    results,
    systemMessage: buildContinuitySystemMessage(results),
  };
};


export const onMessagePersisted = async (params: {
  threadId: string;
  messageId: string;
  messageJson: string;
}): Promise<void> => {
  const config = getContinuityConfig();
  if (!config.enabled || !config.autoCaptureExplicitFacts) return;
  if (!params.threadId || !params.messageId || typeof params.messageJson !== 'string') return;

  const thread = chatThreadDb.getChatThread(params.threadId);
  if (thread?.is_incognito) return;

  const extracted = extractTextFromMessageJson(params.messageJson);
  if (!extracted || extracted.role !== 'user') return;

  const profile = ensureActiveAssistantProfile();
  if (!profile) return;

  const captures = extractExplicitContinuity(extracted.content);
  if (captures.length === 0) return;

  for (const capture of captures) {
    try {
      const existing = continuityDb.findContinuityItemByExactSummary({
        profileId: profile.profile_id,
        kind: capture.kind,
        summary: capture.summary,
      });

      const item = continuityDb.upsertContinuityItem({
        id: existing?.id,
        profile_id: profile.profile_id,
        kind: capture.kind,
        title: capture.title,
        summary: capture.summary,
        status: 'confirmed',
        confidence: 1,
        priority: capture.kind === 'owner_fact' || capture.kind === 'boundary' ? 1 : 0.8,
        scope: 'global',
        source_kind: 'explicit_message',
        source_ref: `message:${params.messageId}:${capture.kind}:${capture.summary}`,
        first_seen_at: existing?.first_seen_at || new Date().toISOString(),
        last_confirmed_at: new Date().toISOString(),
        metadata_json: stringifyJson({
          extractor: EXPLICIT_EXTRACTOR_VERSION,
          threadId: params.threadId,
          messageId: params.messageId,
        }),
      });

      continuityDb.addContinuityEvidence({
        item_id: item.id,
        thread_id: params.threadId,
        message_id: params.messageId,
        excerpt: extracted.content,
        extractor_version: EXPLICIT_EXTRACTOR_VERSION,
      });
    } catch (error) {
      continuityLogger.event({
        level: 'warn',
        event: 'continuity.explicit_capture',
        outcome: 'failed',
        error,
        entity: {
          thread_id: params.threadId,
          message_id: params.messageId,
        },
      });
    }
  }
};
