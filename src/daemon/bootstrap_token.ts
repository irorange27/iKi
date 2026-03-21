import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BOOTSTRAP_TOKEN_PREFIX = 'iki_bootstrap_';

const getBootstrapTokenPath = (userDataPath: string): string =>
  path.join(userDataPath, 'daemon.token');

export const generateBootstrapToken = (): string =>
  `${BOOTSTRAP_TOKEN_PREFIX}${randomBytes(32).toString('hex')}`;

export const rotateBootstrapToken = (userDataPath: string): string => {
  const token = generateBootstrapToken();
  fs.writeFileSync(getBootstrapTokenPath(userDataPath), token, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return token;
};

export const readOrCreateBootstrapToken = (userDataPath: string): string => {
  const tokenPath = getBootstrapTokenPath(userDataPath);
  try {
    const existing = fs.readFileSync(tokenPath, 'utf8').trim();
    if (existing) return existing;
  } catch {
    // fall through to generate
  }

  return rotateBootstrapToken(userDataPath);
};
