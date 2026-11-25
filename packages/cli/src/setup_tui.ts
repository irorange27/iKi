import {
  Container,
  Input,
  Loader,
  ProcessTerminal,
  SelectList,
  Spacer,
  Text,
  TuiAltScreen,
  VStack,
  fuzzyFilter,
  matchesKey,
  truncateToWidth,
  type Component,
  type Focusable,
  type SelectItem,
} from '@earendil-works/pi-tui';
import { addProvider, getProviders } from '@iki/store/providers';
import type { Provider } from '@iki/core/types/provider';
import { listPiBuiltinProviders, type PiProviderSummary } from '@iki/harness/providers';
import { cliTheme, selectListTheme } from './theme';

type SetupWizardChoice = {
  id: string;
  name: string;
  type: string;
  isResponseApi?: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  requiresApiKey: boolean;
  label: string;
  description: string;
  suggestedModels?: string[];
};

const summaryToSetupChoice = (p: PiProviderSummary): SetupWizardChoice => ({
  id: p.id,
  name: p.name,
  type: p.id,
  defaultBaseUrl: p.defaultBaseUrl,
  defaultModel: p.defaultModel,
  requiresApiKey: p.defaultApi !== 'bedrock-converse-stream' && p.defaultApi !== 'google-vertex',
  label: `${p.name} [${p.id}]`,
  description: `${p.modelCount} models · ${p.defaultApi}${p.defaultBaseUrl ? ` · ${p.defaultBaseUrl}` : ''}`,
  suggestedModels: p.models,
});

const CUSTOM_SETUP_CHOICES: readonly SetupWizardChoice[] = [
  {
    id: 'custom_openai',
    name: 'Custom (OpenAI Completions)',
    type: 'openai-compatible',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: '',
    requiresApiKey: false,
    label: 'Custom — OpenAI Chat Completions',
    description: 'openai-completions · any OpenAI-compatible gateway or local server',
  },
  {
    id: 'custom_responses',
    name: 'Custom (OpenAI Responses)',
    type: 'openai-compatible',
    isResponseApi: true,
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: '',
    requiresApiKey: false,
    label: 'Custom — OpenAI Responses API',
    description: 'openai-responses · gateways implementing /v1/responses',
  },
  {
    id: 'custom_anthropic',
    name: 'Custom (Anthropic Messages)',
    type: 'anthropic-compatible',
    defaultBaseUrl: 'http://127.0.0.1:8000/v1',
    defaultModel: '',
    requiresApiKey: false,
    label: 'Custom — Anthropic Messages API',
    description: 'anthropic-messages · proxies implementing /v1/messages',
  },
];

class DividerLine implements Component {
  invalidate(): void {
    /* dynamic per width */
  }
  render(width: number): string[] {
    return [cliTheme.borderMuted('─'.repeat(Math.max(1, width)))];
  }
}

class MaskedInputProxy implements Component, Focusable {
  private readonly inner: Input;
  private _focused = false;

  constructor(placeholder: string) {
    this.inner = new Input({ prompt: ' API Key: ', placeholder });
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.inner.focused = value;
  }

  getValue(): string {
    return this.inner.getValue();
  }

  setValue(value: string): void {
    this.inner.setValue(value);
  }

  handleInput(data: string): void {
    this.inner.handleInput(data);
  }

  invalidate(): void {
    this.inner.invalidate();
  }

  render(width: number): string[] {
    const val = this.inner.getValue();
    if (!val) return this.inner.render(width);
    const masked = '•'.repeat(Math.min(val.length, 48));
    const suffix = cliTheme.dim(` (${val.length} chars)`);
    return [truncateToWidth(` API Key: ${cliTheme.text(masked)}${suffix}`, width)];
  }
}

/** @lintignore Exported for CLI unit tests. */
export class SetupSearchListStep<T> extends Container implements Focusable {
  readonly capturesViewportInput = true;
  private readonly input: Input;
  private readonly listSlot: Container;
  private list: SelectList;
  private readonly items: Array<{ value: string; label: string; description?: string; data: T }>;
  private filtered: Array<{ value: string; label: string; description?: string; data: T }>;
  private readonly allowCustom: boolean;
  private readonly onSelect: (picked: { value: string; data?: T }) => void;
  private readonly onBack: () => void;
  private readonly maxVisible: number;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  constructor(params: {
    heading: string;
    subtitle: string;
    placeholder: string;
    items: Array<{ value: string; label: string; description?: string; data: T }>;
    initialValue?: string;
    maxVisible?: number;
    allowCustom?: boolean;
    hint: string;
    onSelect: (picked: { value: string; data?: T }) => void;
    onBack: () => void;
  }) {
    super();
    this.items = params.items;
    this.filtered = [...params.items];
    this.allowCustom = params.allowCustom === true;
    this.onSelect = params.onSelect;
    this.onBack = params.onBack;
    this.maxVisible = params.maxVisible ?? 12;

    this.addChild(new Text(cliTheme.bold(cliTheme.text(params.heading)), 1, 0));
    this.addChild(new Text(cliTheme.dim(params.subtitle), 1, 0));
    this.addChild(new Spacer(1));

    this.input = new Input({ prompt: ' Search: ', placeholder: params.placeholder });
    this.addChild(this.input);
    this.addChild(new Spacer(1));

    this.listSlot = new Container();
    this.list = this.buildList(params.initialValue);
    this.listSlot.addChild(this.list);
    this.addChild(this.listSlot);

    this.addChild(new Spacer(1));
    this.addChild(new Text(cliTheme.dim(params.hint), 1, 0));
  }

  private buildList(initialValue?: string): SelectList {
    const query = this.input.getValue().trim();
    const selectItems: SelectItem[] = this.filtered.map(item => ({
      value: item.value,
      label: item.label,
      ...(item.description ? { description: item.description } : {}),
    }));
    if (this.allowCustom && query && !this.filtered.some(i => i.value === query)) {
      selectItems.push({
        value: `__custom__:${query}`,
        label: `Use custom model: "${query}"`,
        description: 'Press Enter to use this exact model ID',
      });
    }
    const list = new SelectList(selectItems, this.maxVisible, selectListTheme);
    if (initialValue) {
      const idx = this.filtered.findIndex(i => i.value === initialValue);
      if (idx >= 0) list.setSelectedIndex(idx);
    }
    list.onSelect = selected => {
      if (selected.value.startsWith('__custom__:')) {
        this.onSelect({ value: selected.value.slice('__custom__:'.length) });
        return;
      }
      const found = this.filtered.find(i => i.value === selected.value);
      if (found) this.onSelect({ value: found.value, data: found.data });
    };
    list.onCancel = () => this.onBack();
    return list;
  }

  private refreshFilter(): void {
    const q = this.input.getValue().trim();
    this.filtered = q
      ? fuzzyFilter(this.items, q, item => `${item.label} ${item.value} ${item.description ?? ''}`)
      : [...this.items];
    this.listSlot.clear();
    this.list = this.buildList();
    this.listSlot.addChild(this.list);
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      this.onBack();
      return;
    }
    if (
      matchesKey(data, 'up') ||
      matchesKey(data, 'down') ||
      matchesKey(data, 'pageUp') ||
      matchesKey(data, 'pageDown') ||
      matchesKey(data, 'enter') ||
      matchesKey(data, 'return')
    ) {
      this.list.handleInput(data);
      return;
    }
    const prev = this.input.getValue();
    this.input.handleInput(data);
    if (this.input.getValue() !== prev) {
      this.refreshFilter();
    }
  }
}

/** @lintignore Exported for CLI unit tests. */
export class SetupTextStep extends Container implements Focusable {
  readonly capturesViewportInput = true;
  private readonly inputControl: Input | MaskedInputProxy;
  private readonly errorText: Text;
  private readonly required: boolean;
  private readonly onSubmit: (value: string) => void;
  private readonly onBack: () => void;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.inputControl.focused = value;
  }

  constructor(params: {
    heading: string;
    subtitle: string;
    prompt: string;
    placeholder: string;
    initialValue?: string;
    masked?: boolean;
    required?: boolean;
    hint: string;
    onSubmit: (value: string) => void;
    onBack: () => void;
  }) {
    super();
    this.required = params.required === true;
    this.onSubmit = params.onSubmit;
    this.onBack = params.onBack;

    this.addChild(new Text(cliTheme.bold(cliTheme.text(params.heading)), 1, 0));
    this.addChild(new Text(cliTheme.dim(params.subtitle), 1, 0));
    this.addChild(new Spacer(1));

    this.inputControl = params.masked
      ? new MaskedInputProxy(params.placeholder)
      : new Input({ prompt: params.prompt, placeholder: params.placeholder });
    if (params.initialValue) {
      this.inputControl.setValue(params.initialValue);
    }
    this.addChild(this.inputControl);

    this.errorText = new Text('', 1, 0);
    this.addChild(this.errorText);
    this.addChild(new Spacer(1));
    this.addChild(new Text(cliTheme.dim(params.hint), 1, 0));
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      this.onBack();
      return;
    }
    if (matchesKey(data, 'enter') || matchesKey(data, 'return')) {
      const value = this.inputControl.getValue().trim();
      if (this.required && !value) {
        this.errorText.setText(cliTheme.error('A value is required for this field.'));
        return;
      }
      this.onSubmit(value);
      return;
    }
    this.errorText.setText('');
    this.inputControl.handleInput(data);
  }
}

const renderStepHeader = (params: {
  step: 1 | 2 | 3;
  dataDir: string;
  providerCount: number;
  selectedProvider?: SetupWizardChoice;
  baseUrl?: string;
}): string => {
  const badge = (num: 1 | 2 | 3, label: string) => {
    if (num < params.step) return cliTheme.success(`✓ ${num}. ${label}`);
    if (num === params.step) return cliTheme.bold(cliTheme.accent(`● ${num}. ${label}`));
    return cliTheme.dim(`○ ${num}. ${label}`);
  };
  const lines = [
    `${cliTheme.bold(cliTheme.text('iKi Setup'))}  ${cliTheme.dim(`(${params.providerCount} built-in pi-ai providers · ${params.dataDir}/models.toml)`)}`,
    `${badge(1, 'Provider')}   ${cliTheme.dim('→')}   ${badge(2, 'Endpoint & Key')}   ${cliTheme.dim('→')}   ${badge(3, 'Default Model')}`,
  ];
  if (params.selectedProvider) {
    const ep = params.baseUrl ? ` · ${params.baseUrl}` : '';
    lines.push(cliTheme.dim(`Selected: ${params.selectedProvider.name} [${params.selectedProvider.type}]${ep}`));
  }
  return lines.join('\n');
};

/**
 * Fullscreen pi-tui setup wizard for TTY terminals.
 */
export const runTuiOnboardingWizard = async (options: {
  dataDir: string;
  discoverModels?: (params: {
    providerType: string;
    baseUrl: string;
    apiKey?: string;
  }) => Promise<string[]>;
}): Promise<Provider | null> => {
  const allProviders = listPiBuiltinProviders();
  const choices: SetupWizardChoice[] = [
    ...allProviders.map(summaryToSetupChoice),
    ...CUSTOM_SETUP_CHOICES,
  ];

  const terminal = new ProcessTerminal();
  const tui = new TuiAltScreen(terminal);

  const headerSlot = new Container();
  const bodySlot = new Container();
  const root = new VStack([
    { component: headerSlot, basis: 'auto', grow: 0, shrink: 0, minSize: 3 },
    { component: bodySlot, basis: 0, grow: 1, shrink: 1, minSize: 10 },
  ]);
  tui.addChild(headerSlot);
  tui.addChild(bodySlot);
  tui.setLayoutRoot(root);

  let selectedProvider: SetupWizardChoice | undefined;
  let chosenBaseUrl = '';
  let chosenApiKey = '';

  const updateHeader = (step: 1 | 2 | 3) => {
    headerSlot.clear();
    headerSlot.addChild(new Spacer(1));
    headerSlot.addChild(
      new Text(
        renderStepHeader({
          step,
          dataDir: options.dataDir,
          providerCount: allProviders.length,
          selectedProvider,
          baseUrl: chosenBaseUrl || undefined,
        }),
        1,
        0
      )
    );
    headerSlot.addChild(new DividerLine());
  };

  return await new Promise<Provider | null>(resolve => {
    let finished = false;
    const finish = (provider: Provider | null) => {
      if (finished) return;
      finished = true;
      tui.stop();
      if (provider) {
        process.stdout.write(
          `\nSaved provider "${provider.id}" (${provider.type}, model: ${provider.models[0] ?? ''}) to ${options.dataDir}/models.toml\n\n`
        );
      }
      resolve(provider);
    };

    const showProviderStep = () => {
      selectedProvider = undefined;
      chosenBaseUrl = '';
      chosenApiKey = '';
      updateHeader(1);
      const step = new SetupSearchListStep<SetupWizardChoice>({
        heading: 'Choose an LLM provider',
        subtitle: 'Type to filter built-in pi-ai providers or custom API endpoints.',
        placeholder: 'e.g. anthropic, google, custom...',
        items: choices.map(c => ({
          value: c.id,
          label: c.label,
          description: c.description,
          data: c,
        })),
        maxVisible: 14,
        hint: '↑/↓ navigate · type to search · Enter select · Esc cancel',
        onSelect: picked => {
          if (!picked.data) return;
          selectedProvider = picked.data;
          chosenBaseUrl = picked.data.defaultBaseUrl;
          showBaseUrlStep();
        },
        onBack: () => finish(null),
      });
      bodySlot.clear();
      bodySlot.addChild(new Spacer(1));
      bodySlot.addChild(step);
      tui.setFocus(step);
      tui.requestRender();
    };

    const showBaseUrlStep = () => {
      const provider = selectedProvider!;
      updateHeader(2);
      const step = new SetupTextStep({
        heading: `${provider.name} — Endpoint Base URL`,
        subtitle: provider.defaultBaseUrl
          ? 'Press Enter to keep the canonical endpoint, or enter a custom proxy / gateway URL.'
          : 'Optional for this provider — press Enter to use the provider SDK default.',
        prompt: ' Base URL: ',
        placeholder: provider.defaultBaseUrl || 'https://...',
        initialValue: chosenBaseUrl,
        required: false,
        hint: 'Enter continue · Esc back to provider list',
        onSubmit: val => {
          chosenBaseUrl = val || provider.defaultBaseUrl;
          showApiKeyStep();
        },
        onBack: () => showProviderStep(),
      });
      bodySlot.clear();
      bodySlot.addChild(new Spacer(1));
      bodySlot.addChild(step);
      tui.setFocus(step);
      tui.requestRender();
    };

    const showApiKeyStep = () => {
      const provider = selectedProvider!;
      updateHeader(2);
      const step = new SetupTextStep({
        heading: `${provider.name} — API Key`,
        subtitle: provider.requiresApiKey
          ? 'Paste or type your API key (masked on screen; saved locally in models.toml).'
          : 'Optional for this provider — press Enter to skip if not required.',
        prompt: ' API Key: ',
        placeholder: provider.requiresApiKey ? 'sk-...' : '(optional — press Enter to skip)',
        initialValue: chosenApiKey,
        masked: true,
        required: provider.requiresApiKey,
        hint: 'Enter continue · Esc back to Base URL',
        onSubmit: val => {
          chosenApiKey = val;
          void showModelStep();
        },
        onBack: () => showBaseUrlStep(),
      });
      bodySlot.clear();
      bodySlot.addChild(new Spacer(1));
      bodySlot.addChild(step);
      tui.setFocus(step);
      tui.requestRender();
    };

    const showModelStep = async () => {
      const provider = selectedProvider!;
      updateHeader(3);
      let modelIds = provider.suggestedModels ? [...provider.suggestedModels] : [];

      if (modelIds.length === 0 && options.discoverModels && chosenBaseUrl) {
        const loader = new Loader(
          tui,
          text => cliTheme.accent(text),
          text => cliTheme.dim(text),
          `Discovering models from ${chosenBaseUrl}...`
        );
        bodySlot.clear();
        bodySlot.addChild(new Spacer(1));
        bodySlot.addChild(loader);
        loader.start();
        tui.requestRender();
        try {
          modelIds = await options.discoverModels({
            providerType: provider.type,
            baseUrl: chosenBaseUrl,
            ...(chosenApiKey ? { apiKey: chosenApiKey } : {}),
          });
        } catch {
          modelIds = [];
        } finally {
          loader.stop();
        }
      }

      if (provider.defaultModel && !modelIds.includes(provider.defaultModel)) {
        modelIds = [provider.defaultModel, ...modelIds];
      } else if (provider.defaultModel) {
        modelIds = [provider.defaultModel, ...modelIds.filter(m => m !== provider.defaultModel)];
      }

      if (modelIds.length === 0) {
        const manualStep = new SetupTextStep({
          heading: `${provider.name} — Default Model ID`,
          subtitle: 'Enter the exact model ID served by your endpoint.',
          prompt: ' Model ID: ',
          placeholder: 'e.g. gpt-4.1 or deepseek-chat',
          required: true,
          hint: 'Enter save · Esc back to API Key',
          onSubmit: val => saveAndFinish(val),
          onBack: () => showApiKeyStep(),
        });
        bodySlot.clear();
        bodySlot.addChild(new Spacer(1));
        bodySlot.addChild(manualStep);
        tui.setFocus(manualStep);
        tui.requestRender();
        return;
      }

      const step = new SetupSearchListStep<string>({
        heading: `${provider.name} — Default Model`,
        subtitle: 'Pick a recommended model from the catalog, or type any custom model ID and press Enter.',
        placeholder: 'filter models or type a custom model ID...',
        items: modelIds.map((id, idx) => ({
          value: id,
          label: id,
          ...(idx === 0 && id === provider.defaultModel ? { description: 'recommended default' } : {}),
          data: id,
        })),
        initialValue: provider.defaultModel || modelIds[0],
        maxVisible: 12,
        allowCustom: true,
        hint: '↑/↓ navigate · type to filter or enter custom ID · Enter save · Esc back',
        onSelect: picked => saveAndFinish(picked.value),
        onBack: () => showApiKeyStep(),
      });
      bodySlot.clear();
      bodySlot.addChild(new Spacer(1));
      bodySlot.addChild(step);
      tui.setFocus(step);
      tui.requestRender();
    };

    const saveAndFinish = (modelId: string) => {
      const provider = selectedProvider!;
      const existing = getProviders();
      let providerId = provider.id;
      let ordinal = 1;
      while (existing.some(p => p.id === providerId && p.baseUrl !== chosenBaseUrl)) {
        ordinal += 1;
        providerId = `${provider.id}_${ordinal}`;
      }
      const saved = addProvider({
        id: providerId,
        name: provider.name,
        type: provider.type,
        apiKey: chosenApiKey || 'not-required',
        baseUrl: chosenBaseUrl,
        enabled: true,
        models: [modelId],
        ...(provider.isResponseApi ? { isResponseApi: true } : {}),
      });
      finish(saved);
    };

    showProviderStep();
    tui.start();
  });
};
