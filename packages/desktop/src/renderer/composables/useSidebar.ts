import { ref, computed, readonly, onScopeDispose, getCurrentScope } from 'vue';

let globalSidebarState: ReturnType<typeof createSidebarState> | null = null;

const AUTO_COLLAPSE_BELOW = 760;
const AUTO_RESTORE_ABOVE = AUTO_COLLAPSE_BELOW + 96;

function createSidebarState(initialState = true) {
  const width = ref<number>(200);
  const showExternalChats = ref(false);

  const setWidth = (newWidth: number): void => {
    width.value = Math.min(Math.max(newWidth, 190), 500);
  };

  const isExpanded = ref<boolean>(initialState);
  let autoCollapsed = false;

  const isCollapsed = computed<boolean>(() => !isExpanded.value);

  const expand = (): void => {
    autoCollapsed = false;
    isExpanded.value = true;
  };

  const collapse = (): void => {
    autoCollapsed = false;
    isExpanded.value = false;
  };

  const toggle = (): void => {
    autoCollapsed = false;
    isExpanded.value = !isExpanded.value;
  };

  let belowThreshold: boolean | null = null;

  const applyResponsiveCollapse = (): void => {
    const below = window.innerWidth < AUTO_COLLAPSE_BELOW;
    if (belowThreshold !== null && below === belowThreshold) return;
    belowThreshold = below;
    if (below) {
      if (isExpanded.value && !autoCollapsed) {
        autoCollapsed = true;
        isExpanded.value = false;
      }
      return;
    }
    if (autoCollapsed && !isExpanded.value && window.innerWidth >= AUTO_RESTORE_ABOVE) {
      autoCollapsed = false;
      isExpanded.value = true;
    }
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', applyResponsiveCollapse);
    applyResponsiveCollapse();
    if (getCurrentScope()) {
      onScopeDispose(() => {
        window.removeEventListener('resize', applyResponsiveCollapse);
      });
    }
  }

  const setShowExternalChats = (nextValue: boolean): void => {
    showExternalChats.value = Boolean(nextValue);
  };

  const toggleExternalChats = (): void => {
    showExternalChats.value = !showExternalChats.value;
  };

  return {
    isExpanded: readonly(isExpanded),
    isCollapsed: readonly(isCollapsed),
    showExternalChats: readonly(showExternalChats),
    expand,
    collapse,
    toggle,
    setShowExternalChats,
    toggleExternalChats,
    width: readonly(width),
    setWidth,
  };
}

export function createSidebar() {
  if (!globalSidebarState) {
    globalSidebarState = createSidebarState();
  }
  return globalSidebarState;
}

export function useSidebar() {
  if (!globalSidebarState) {
    throw new Error('Sidebar not initialized. Call createSidebar() in App.vue first.');
  }
  return globalSidebarState;
}
