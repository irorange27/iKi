import { watch } from 'vue';
import { storeToRefs } from 'pinia';
import { useConfigStore } from '../store/config';
import { setLocale } from '../i18n';

export const useAppLocale = () => {
  const store = useConfigStore();
  const { config } = storeToRefs(store);

  watch(
    () => config.value.general.language,
    value => {
      const locale = setLocale(value === 'zh-CN' ? value : 'en');
      document.documentElement.lang = locale;
    },
    { immediate: true }
  );
};
