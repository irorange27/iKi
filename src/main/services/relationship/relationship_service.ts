import * as chatThreadDb from '../../../core/db/chat_thread';
import * as relationshipDb from '../../../core/db/relationship';
import type { ChatThread } from '../../../shared/types/chat';
import type {
  RelationshipOverview,
  RelationshipOwnerBaseline,
  RelationshipSourceKind,
  RelationshipStateRecord,
} from '../../../shared/types/relationship';
import {
  parseJsonObjectRecord,
  parseJsonStringArray as parseRawJsonStringArray,
} from '../../../shared/utils/json';
import { normalizeWhitespace } from '../../../shared/utils/text';
import { getOrCreateActiveIdentityProfile } from '../identity/identity_service';

const parseJsonObject = (value: string | null | undefined): Record<string, unknown> =>
  parseJsonObjectRecord(value);

const parseJsonStringArray = (value: string | null | undefined): string[] =>
  parseRawJsonStringArray(value)
    .map(entry => normalizeWhitespace(entry))
    .filter(Boolean);

const getOwnerBaseline = (): RelationshipOwnerBaseline => {
  const profile = getOrCreateActiveIdentityProfile();
  return {
    owner_label: normalizeWhitespace(profile?.owner_name) || 'the user',
    relationship_to_owner:
      normalizeWhitespace(profile?.relationship_to_owner) || 'trusted personal AI companion',
  };
};

type ParsedThreadFacts = {
  sourceKind: RelationshipSourceKind;
  subjectLabel: string;
  relationshipSummary: string;
  preferredAddress: string;
  metadata: Record<string, unknown>;
};

const parseThreadFacts = (thread: ChatThread): ParsedThreadFacts => {
  const metadata = parseJsonObject(thread.metadata);
  const source = normalizeWhitespace(metadata.source);
  const messageType = normalizeWhitespace(metadata.message_type);
  const userId =
    typeof metadata.user_id === 'string' || typeof metadata.user_id === 'number'
      ? String(metadata.user_id).trim()
      : '';
  const groupId =
    typeof metadata.group_id === 'string' || typeof metadata.group_id === 'number'
      ? String(metadata.group_id).trim()
      : '';

  if (source === 'napcat' && messageType === 'private') {
    return {
      sourceKind: 'napcat-private',
      subjectLabel: normalizeWhitespace(thread.title) || `QQ User ${userId || thread.id}`,
      relationshipSummary:
        'QQ private thread. Treat it as a direct external conversation, but do not assume the sender is the owner unless that is explicitly established.',
      preferredAddress: 'Keep replies concise and direct in a one-to-one chat style.',
      metadata: {
        source: 'napcat',
        message_type: 'private',
        user_id: userId || null,
        client_id: thread.client_id || null,
      },
    };
  }

  if (source === 'napcat' && messageType === 'group') {
    return {
      sourceKind: 'napcat-group',
      subjectLabel: normalizeWhitespace(thread.title) || `QQ Group ${groupId || thread.id}`,
      relationshipSummary:
        'QQ group thread. Treat it as shared group context rather than a one-to-one owner conversation, and avoid over-personal assumptions about any single participant.',
      preferredAddress: 'Address the group context briefly and avoid assuming shared private context.',
      metadata: {
        source: 'napcat',
        message_type: 'group',
        group_id: groupId || null,
        client_id: thread.client_id || null,
      },
    };
  }

  if (normalizeWhitespace(thread.client_id)) {
    return {
      sourceKind: 'external-client-thread',
      subjectLabel: normalizeWhitespace(thread.title) || thread.id,
      relationshipSummary:
        'External client thread. Treat it as a distinct access layer and avoid assuming it is a direct owner conversation unless persisted relationship state says so.',
      preferredAddress: '',
      metadata: {
        source: source || 'client',
        client_id: thread.client_id || null,
      },
    };
  }

  return {
    sourceKind: 'desktop-owner-thread',
    subjectLabel: normalizeWhitespace(thread.title) || 'Desktop thread',
    relationshipSummary:
      'Desktop-local direct conversation with the owner. This thread is the closest thing to the owner control plane unless persisted context says otherwise.',
    preferredAddress: 'Respond as a direct ongoing conversation with the owner.',
    metadata: {
      source: 'desktop',
      client_id: null,
    },
  };
};

const mergeSeedWithExisting = (
  existing: RelationshipStateRecord | null,
  seed: ParsedThreadFacts
): {
  source_kind: RelationshipSourceKind;
  subject_label: string;
  relationship_summary: string;
  preferred_address: string;
  boundaries_json?: string | null;
  notes_json?: string | null;
  metadata: string;
  last_interaction_at?: string | null;
} => {
  const existingMetadata = parseJsonObject(existing?.metadata);
  return {
    source_kind: seed.sourceKind,
    subject_label: normalizeWhitespace(existing?.subject_label) || seed.subjectLabel,
    relationship_summary:
      normalizeWhitespace(existing?.relationship_summary) || seed.relationshipSummary,
    preferred_address: normalizeWhitespace(existing?.preferred_address) || seed.preferredAddress,
    boundaries_json: existing?.boundaries_json ?? null,
    notes_json: existing?.notes_json ?? null,
    metadata: JSON.stringify({
      ...existingMetadata,
      ...seed.metadata,
    }),
    last_interaction_at: existing?.last_interaction_at ?? null,
  };
};

export const ensureThreadRelationshipState = (threadId: string): RelationshipStateRecord | null => {
  const normalizedThreadId = normalizeWhitespace(threadId);
  if (!normalizedThreadId) return null;

  const profile = getOrCreateActiveIdentityProfile();
  if (!profile) return null;

  const thread = chatThreadDb.getChatThread(normalizedThreadId);
  if (!thread) return null;

  const existing = relationshipDb.getRelationshipState(profile.id, 'thread', normalizedThreadId);
  const seed = parseThreadFacts(thread);
  const merged = mergeSeedWithExisting(existing, seed);

  return relationshipDb.upsertRelationshipState({
    id: existing?.id,
    profile_id: profile.id,
    scope_type: 'thread',
    scope_id: normalizedThreadId,
    source_kind: merged.source_kind,
    subject_label: merged.subject_label,
    relationship_summary: merged.relationship_summary,
    preferred_address: merged.preferred_address,
    boundaries_json: merged.boundaries_json,
    notes_json: merged.notes_json,
    metadata: merged.metadata,
    last_interaction_at: merged.last_interaction_at,
  });
};

export const touchThreadRelationshipState = (
  threadId: string,
  atIso?: string
): RelationshipStateRecord | null => {
  const existing = ensureThreadRelationshipState(threadId);
  if (!existing) return null;

  return relationshipDb.upsertRelationshipState({
    id: existing.id,
    profile_id: existing.profile_id,
    scope_type: existing.scope_type,
    scope_id: existing.scope_id,
    source_kind: existing.source_kind,
    subject_label: existing.subject_label,
    relationship_summary: existing.relationship_summary,
    preferred_address: existing.preferred_address,
    boundaries_json: existing.boundaries_json,
    notes_json: existing.notes_json,
    metadata: existing.metadata,
    last_interaction_at: normalizeWhitespace(atIso) || new Date().toISOString(),
  });
};

export const listRecentRelationshipStates = (limit = 8): RelationshipStateRecord[] => {
  const profile = getOrCreateActiveIdentityProfile();
  if (!profile) return [];
  return relationshipDb.listRelationshipStates({
    profileId: profile.id,
    scopeType: 'thread',
    limit,
  });
};

export const getRelationshipOverview = (limit = 8): RelationshipOverview => ({
  owner: getOwnerBaseline(),
  recentStates: listRecentRelationshipStates(limit),
});

export const getRelationshipContextMessage = (threadId?: string): string => {
  const normalizedThreadId = normalizeWhitespace(threadId);
  if (!normalizedThreadId) return '';

  const owner = getOwnerBaseline();
  const relationshipState = ensureThreadRelationshipState(normalizedThreadId);
  if (!relationshipState) return '';

  const boundaries = parseJsonStringArray(relationshipState.boundaries_json).slice(0, 2);
  const notes = parseJsonStringArray(relationshipState.notes_json).slice(0, 2);

  return [
    'Relationship context for iKi:',
    `- Owner baseline: ${owner.relationship_to_owner}`,
    `- Current thread: ${relationshipState.subject_label || relationshipState.scope_id}`,
    `- Thread kind: ${relationshipState.source_kind}`,
    `- Thread relationship: ${relationshipState.relationship_summary}`,
    relationshipState.preferred_address
      ? `- Preferred address/style: ${relationshipState.preferred_address}`
      : '',
    ...(boundaries.length > 0 ? ['- Relationship boundaries:', ...boundaries.map(item => `  - ${item}`)] : []),
    ...(notes.length > 0 ? ['- Relationship notes:', ...notes.map(item => `  - ${item}`)] : []),
  ]
    .filter(Boolean)
    .join('\n');
};
