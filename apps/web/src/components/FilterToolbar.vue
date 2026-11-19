<script setup lang="ts">
import { ref, useId } from 'vue';
import { SlidersHorizontal, X } from 'lucide-vue-next';

defineProps<{ active: { key: string; label: string; clear: () => void }[] }>();
const expanded = ref(false);
const panelId = useId();
</script>
<template>
  <div class="toolbar filter-toolbar">
    <slot name="search" />
    <button
      class="button filter-toggle"
      type="button"
      :aria-expanded="expanded"
      :aria-controls="panelId"
      @click="expanded = !expanded"
    >
      <SlidersHorizontal :size="16" />筛选<span v-if="active.length">{{ active.length }}</span>
    </button>
    <div :id="panelId" class="filter-fields" :class="{ expanded }"><slot /></div>
    <div v-if="active.length" class="filter-chips" aria-label="已选筛选条件">
      <button
        v-for="item in active"
        :key="item.key"
        type="button"
        :aria-label="'移除筛选：' + item.label"
        @click="item.clear()"
      >
        {{ item.label }}<X :size="12" />
      </button>
    </div>
  </div>
</template>
<style scoped>
.filter-toolbar {
  margin: 0;
  padding: var(--space-4);
}
.filter-toggle,
.filter-chips {
  display: none;
}
.filter-fields {
  display: contents;
}
@media (max-width: 760px) {
  .filter-toolbar {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 12px;
  }
  .filter-toggle {
    display: inline-flex;
    min-height: 40px;
  }
  .filter-toolbar :slotted(.search-field) {
    min-width: 0;
    grid-column: auto;
    min-height: 40px;
  }
  .filter-fields {
    display: none;
  }
  .filter-fields.expanded {
    display: grid;
    grid-column: 1/-1;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    padding-top: 4px;
  }
  .filter-fields :slotted(select),
  .filter-fields :slotted(button) {
    width: 100%;
    min-width: 0;
    min-height: 40px;
  }
  .filter-fields :slotted(.date-range) {
    grid-column: 1/-1;
  }
  .filter-chips {
    grid-column: 1/-1;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .filter-chips button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
    border: 1px solid var(--border);
    border-radius: 20px;
    background: var(--surface-soft);
    color: var(--secondary);
    padding: 3px 9px;
    font-size: 12px;
  }
}
</style>
