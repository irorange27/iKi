declare module 'vue-markdown-render' {
  import { DefineComponent } from 'vue';

  export interface VueMarkdownProps {
    source: string;
    options?: Record<string, unknown>;
    plugins?: unknown[];
  }

  const VueMarkdown: DefineComponent<VueMarkdownProps>;
  export default VueMarkdown;
}
