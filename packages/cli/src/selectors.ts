import {
  Box,
  Container,
  Input,
  SelectList,
  Spacer,
  Text,
  fuzzyFilter,
  matchesKey,
  type Focusable,
  type SelectItem,
  type SelectListTheme,
  type TUI,
} from '@earendil-works/pi-tui';

export type PickerOption<T> = {
  value: string;
  label: string;
  description?: string;
  data: T;
};

type PickerStyle = {
  title: (text: string) => string;
  dim: (text: string) => string;
  panelBg?: (text: string) => string;
  selectList: SelectListTheme;
};

class SearchablePicker<T> extends Container implements Focusable {
  readonly capturesViewportInput = true;
  private readonly input: Input;
  private readonly listContainer: Container;
  private list: SelectList;
  private filtered: Array<PickerOption<T>>;
  private readonly items: Array<PickerOption<T>>;
  private readonly theme: PickerStyle;
  private readonly maxVisible: number;
  private readonly onSelect: (item: PickerOption<T>) => void;
  private readonly onCancel: () => void;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.input.focused = value;
  }

  constructor(params: {
    title: string;
    subtitle?: string;
    items: Array<PickerOption<T>>;
    initialValue?: string;
    maxVisible?: number;
    theme: PickerStyle;
    onSelect: (item: PickerOption<T>) => void;
    onCancel: () => void;
  }) {
    super();
    this.items = params.items;
    this.filtered = [...params.items];
    this.theme = params.theme;
    this.maxVisible = params.maxVisible ?? 10;
    this.onSelect = params.onSelect;
    this.onCancel = params.onCancel;

    const box = new Box(2, 1, this.theme.panelBg);
    box.addChild(new Text(this.theme.title(params.title), 0, 0));
    if (params.subtitle) {
      box.addChild(new Text(this.theme.dim(params.subtitle), 0, 0));
    }
    box.addChild(new Spacer(1));

    this.input = new Input({ prompt: 'Filter: ', placeholder: 'type to filter...' });
    box.addChild(this.input);
    box.addChild(new Spacer(1));

    this.listContainer = new Container();
    this.list = this.createList(params.initialValue);
    this.listContainer.addChild(this.list);
    box.addChild(this.listContainer);

    box.addChild(new Spacer(1));
    box.addChild(new Text(this.theme.dim('↑/↓ navigate · Enter select · Esc cancel'), 0, 0));

    this.addChild(box);
  }

  private createList(initialValue?: string): SelectList {
    const selectItems: SelectItem[] = this.filtered.map(item => ({
      value: item.value,
      label: item.label,
      ...(item.description ? { description: item.description } : {}),
    }));
    const list = new SelectList(selectItems, this.maxVisible, this.theme.selectList);
    if (initialValue) {
      const idx = this.filtered.findIndex(item => item.value === initialValue);
      if (idx >= 0) list.setSelectedIndex(idx);
    }
    list.onSelect = selected => {
      const found = this.filtered.find(item => item.value === selected.value);
      if (found) this.onSelect(found);
    };
    list.onCancel = () => this.onCancel();
    return list;
  }

  private applyFilter(query: string): void {
    const q = query.trim();
    this.filtered = q
      ? fuzzyFilter(this.items, q, item => `${item.label} ${item.description ?? ''}`)
      : [...this.items];
    this.listContainer.clear();
    this.list = this.createList();
    this.listContainer.addChild(this.list);
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
      this.onCancel();
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
    const next = this.input.getValue();
    if (next !== prev) {
      this.applyFilter(next);
    }
  }
}

export const openSearchablePickerOverlay = <T>(params: {
  tui: TUI;
  title: string;
  subtitle?: string;
  items: Array<PickerOption<T>>;
  initialValue?: string;
  theme: PickerStyle;
}): Promise<PickerOption<T> | null> =>
  new Promise(resolve => {
    let settled = false;
    let handle: ReturnType<TUI['showOverlay']> | null = null;
    const close = (result: PickerOption<T> | null) => {
      if (settled) return;
      settled = true;
      handle?.hide();
      params.tui.requestRender();
      resolve(result);
    };

    const picker = new SearchablePicker({
      title: params.title,
      ...(params.subtitle ? { subtitle: params.subtitle } : {}),
      items: params.items,
      ...(params.initialValue ? { initialValue: params.initialValue } : {}),
      theme: params.theme,
      onSelect: item => close(item),
      onCancel: () => close(null),
    });

    handle = params.tui.showOverlay(picker, {
      anchor: 'center',
      width: '86%',
      maxHeight: '75%',
    });
    params.tui.requestRender();
  });
