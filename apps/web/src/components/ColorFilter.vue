<script setup lang="ts">
import {
  SelectRoot,
  SelectTrigger,
  SelectPortal,
  SelectContent,
  SelectViewport,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
} from 'reka-ui';
import { Check, ChevronDown } from 'lucide-vue-next';

defineProps<{ modelValue: string; colors: string[] }>();
const emit = defineEmits<{ 'update:modelValue': [value: string] }>();
</script>

<template>
  <SelectRoot
    :model-value="modelValue || 'all'"
    @update:model-value="
      emit('update:modelValue', !$event || $event === 'all' ? '' : String($event))
    "
  >
    <SelectTrigger class="color-filter-trigger" aria-label="按颜色筛选">
      <span
        class="color-filter-swatch"
        :class="{ 'all-colors': !modelValue }"
        :style="modelValue ? { background: modelValue } : undefined"
        aria-hidden="true"
      />
      <span>{{ modelValue || '所有颜色' }}</span>
      <ChevronDown :size="14" aria-hidden="true" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="color-filter-options" position="popper" :side-offset="6">
        <SelectViewport>
          <SelectItem
            v-for="value in ['all', ...colors]"
            :key="value"
            :value="value"
            class="color-filter-option"
          >
            <span
              class="color-filter-swatch"
              :class="{ 'all-colors': value === 'all' }"
              :style="value !== 'all' ? { background: value } : undefined"
              aria-hidden="true"
            />
            <SelectItemText>{{ value === 'all' ? '所有颜色' : value }}</SelectItemText>
            <SelectItemIndicator class="color-filter-check"
              ><Check :size="14"
            /></SelectItemIndicator>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
