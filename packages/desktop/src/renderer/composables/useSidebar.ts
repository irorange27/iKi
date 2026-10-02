import { ref, computed, readonly, onScopeDispose, getCurrentScope } from 'vue';

let globalSidebarState: ReturnType<typeof createSidebarState> | null = null;

// Below this window width the sidebar folds itself away so the conversation
// keeps its ground (DSH collapses at the same 1024px mark); it only comes
// back once the window clears the restore mark, so a width hovering around
// the threshold cannot make the panel flap. Both transitions ride the shell's
// existing width transition + content fade, so the fold is animated.
const AUTO_COLLAPSE_BELOW = 1024;
const AUTO_RESTORE_ABOVE = AUTO_COLLAPSE_BELOW + 96;

function createSidebarState(initialState = true) {
  const width = ref<number>(200);
  const showExternalChats = ref(false);

  const setWidth = (newWidth: number): void => {
    width.value = Math.min(Math.max(newWidth, 190), 500);
  };

  const isExpanded = ref<boolean>(initialState);
  // True while the folded state was caused by the window-width watcher and the
  // user has not touched the toggle since — only then may the watcher restore.
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

  // Act on crossings of the threshold, not on every resize event: after a
  // manual expand at a narrow width, resizing within the narrow range must
  // not yank the panel shut again. The first call counts as a crossing so a
  // app booted on a small window starts folded.
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

// 主应用中调用此函数初始化
export function createSidebar() {
  if (!globalSidebarState) {
    globalSidebarState = createSidebarState();
  }
  return globalSidebarState;
}

// 组件中使用此函数获取共享状态
export function useSidebar() {
  if (!globalSidebarState) {
    throw new Error('Sidebar not initialized. Call createSidebar() in App.vue first.');
  }
  return globalSidebarState;
}
// export interface SidebarState {
//   isExpanded: Readonly<Ref<boolean>>
//   isCollapsed: Readonly<Ref<boolean>>
//   expand: () => void
//   collapse: () => void
//   toggle: () => void
// }

// export function useSidebar(initialExpanded = true): SidebarState {
//   const isExpanded = ref<boolean>(initialExpanded)

//   const isCollapsed = computed<boolean>(() => !isExpanded.value)

//   const expand = (): void => {
//     isExpanded.value = true
//   }

//   const collapse = (): void => {
//     isExpanded.value = false
//   }

//   const toggle = (): void => {
//     isExpanded.value = !isExpanded.value
//   }

//   return {
//     isExpanded: readonly(isExpanded),
//     isCollapsed: readonly(isCollapsed),
//     expand,
//     collapse,
//     toggle,
//   }
// }
