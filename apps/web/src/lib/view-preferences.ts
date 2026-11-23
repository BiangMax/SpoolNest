import { ref, watch, type Ref } from 'vue';
import type { ZodType } from 'zod';

export function useViewPreference<T>(key: string, schema: ZodType<T>) {
  const storageKey = `spoolnest-view:${key}`;
  let saved: unknown;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (raw !== null) saved = JSON.parse(raw);
  } catch {
    // The view still works when storage is blocked or data has become unreadable.
  }
  const preference = ref(schema.parse(saved));
  watch(
    preference,
    (value) => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify(value));
      } catch {
        // Keep the current selection in memory if it cannot be saved.
      }
    },
    { flush: 'sync' },
  );
  return preference;
}

export function filterChip<T extends string>(
  key: string,
  selection: Ref<T>,
  defaultValue: T,
  label: string = selection.value,
) {
  if (selection.value === defaultValue) return [];
  return [
    {
      key,
      label,
      clear: () => {
        selection.value = defaultValue;
      },
    },
  ];
}
