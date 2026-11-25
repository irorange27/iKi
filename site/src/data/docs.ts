import { CORE_DOC_PAGES } from './docs_core';
import { RUNTIME_DOC_PAGES } from './docs_runtime';
import type { DocPage } from './types';

export const DOC_PAGES: DocPage[] = [...CORE_DOC_PAGES, ...RUNTIME_DOC_PAGES];

export const findDocPage = (slug: string): DocPage =>
  DOC_PAGES.find(page => page.slug === slug) ?? DOC_PAGES[0]!;
