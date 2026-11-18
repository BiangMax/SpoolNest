<script setup lang="ts">
import type { Component } from 'vue';
defineProps<{
  label: string;
  value: string | number;
  unit?: string;
  icon: Component;
  note?: string;
}>();
</script>
<template>
  <div class="stat-card">
    <span><component :is="icon" :size="16" />{{ label }}</span>
    <strong
      >{{ value }}<small v-if="unit">{{ unit }}</small></strong
    >
    <div class="stat-foot">
      <slot>{{ note }}</slot>
    </div>
  </div>
</template>
