import { ref, computed, readonly } from 'vue';

let globalSidebarState: ReturnType<typeof createSidebarState> | null = null;

function createSidebarState(initialState = true) {
  const width = ref<number>(200);

  const setWidth = (newWidth: number): void => {
    width.value = Math.min(Math.max(newWidth, 190), 500);
  };

  const isExpanded = ref<boolean>(initialState);

  const isCollapsed = computed<boolean>(() => !isExpanded.value);

  const expand = (): void => {
    isExpanded.value = true;
  };

  const collapse = (): void => {
    isExpanded.value = false;
  };

  const toggle = (): void => {
    isExpanded.value = !isExpanded.value;
  };

  return {
    isExpanded: readonly(isExpanded),
    isCollapsed: readonly(isCollapsed),
    expand,
    collapse,
    toggle,
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
