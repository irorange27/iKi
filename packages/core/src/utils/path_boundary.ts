import path from 'node:path';

export const isPathWithinRoot = (root: string, candidate: string): boolean => {
  const relativePath = path.relative(root, candidate);
  return !(relativePath.startsWith('..') || path.isAbsolute(relativePath));
};
