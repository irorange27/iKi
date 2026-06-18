import fs from 'node:fs';
import path from 'node:path';

import { createLogger } from '@iki/core/logger';
import { getUserDataPath } from '@iki/core/platform';

const identityBrainLogger = createLogger({ module: 'identity_brain' });

type BrainDocument = {
  key: string;
  fileName: string;
  legacyFileNames?: string[];
  title: string;
  template: string;
};

const BRAIN_ROOT_DIR = 'brain';
const BRAIN_SUBDIRECTORIES = ['memory_inbox', 'reflections'] as const;
const BRAIN_DOCUMENTS: BrainDocument[] = [
  {
    key: 'iki',
    fileName: 'iki.md',
    title: 'iKi',
    template: [
      '# iKi',
      '',
      '<!-- Keep this concise. Describe who iKi is, its values, boundaries, and reply style. -->',
      '',
    ].join('\n'),
  },
  {
    key: 'owner',
    fileName: 'owner.md',
    title: 'Owner',
    template: [
      '# Owner',
      '',
      '<!-- Store only confirmed, durable facts about the owner here. -->',
      '',
    ].join('\n'),
  },
];

const normalizeMarkdown = (value: string): string =>
  value.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();

const stripHtmlComments = (value: string): string => value.replace(/<!--[\s\S]*?-->/g, '');

const hasMeaningfulMarkdown = (value: string): boolean => {
  const normalized = normalizeMarkdown(stripHtmlComments(value));
  if (!normalized) return false;

  const signal = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .join(' ');

  return signal.trim().length > 0;
};

const getBrainRootPath = (): string => path.join(getUserDataPath(), BRAIN_ROOT_DIR);

const ensureDirectory = (directoryPath: string) => {
  fs.mkdirSync(directoryPath, { recursive: true });
};

const ensureDocument = (rootPath: string, document: BrainDocument) => {
  const filePath = path.join(rootPath, document.fileName);
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, document.template, 'utf8');
};

const getDocumentCandidatePaths = (rootPath: string, document: BrainDocument): string[] => [
  path.join(rootPath, document.fileName),
  ...(document.legacyFileNames ?? []).map(fileName => path.join(rootPath, fileName)),
];

export const getIdentityBrainDirectoryPath = (): string => getBrainRootPath();

export const ensureIdentityBrainLayout = (): string => {
  const rootPath = getBrainRootPath();
  try {
    ensureDirectory(rootPath);

    for (const subdirectory of BRAIN_SUBDIRECTORIES) {
      ensureDirectory(path.join(rootPath, subdirectory));
    }

    for (const document of BRAIN_DOCUMENTS) {
      ensureDocument(rootPath, document);
    }
  } catch (error) {
    identityBrainLogger.event({
      level: 'warn',
      event: 'identity.brain.ensure_layout',
      outcome: 'degraded',
      error,
      data: {
        root_path: rootPath,
      },
    });
  }

  return rootPath;
};

const readBrainDocument = (rootPath: string, document: BrainDocument): string => {
  for (const filePath of getDocumentCandidatePaths(rootPath, document)) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const normalized = normalizeMarkdown(stripHtmlComments(raw));
      if (!hasMeaningfulMarkdown(normalized)) continue;
      return normalized;
    } catch (error) {
      if (!fs.existsSync(filePath)) continue;
      identityBrainLogger.event({
        level: 'warn',
        event: 'identity.brain.read_document',
        outcome: 'degraded',
        error,
        data: {
          file_path: filePath,
        },
      });
      return '';
    }
  }

  return '';
};

export const getIdentityBrainDocuments = (): Record<string, string> => {
  const rootPath = ensureIdentityBrainLayout();
  return BRAIN_DOCUMENTS.reduce<Record<string, string>>((record, document) => {
    record[document.key] = readBrainDocument(rootPath, document);
    return record;
  }, {});
};
