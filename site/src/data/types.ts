export type Locale = 'en' | 'zh';

export type DocSection = {
  id: string;
  title: Record<Locale, string>;
  blocks: DocBlock[];
};

export type DocBlock =
  | { kind: 'p'; text: Record<Locale, string> }
  | { kind: 'ul'; items: Array<Record<Locale, string>> }
  | { kind: 'code'; lang: string; label?: string; code: string }
  | {
      kind: 'table';
      headers: Record<Locale, string[]>;
      rows: Array<Record<Locale, string[]>>;
    }
  | {
      kind: 'note';
      tone: 'info' | 'tip';
      title: Record<Locale, string>;
      text: Record<Locale, string>;
    };

export type DocPage = {
  slug: string;
  category: Record<Locale, string>;
  title: Record<Locale, string>;
  summary: Record<Locale, string>;
  sections: DocSection[];
};
