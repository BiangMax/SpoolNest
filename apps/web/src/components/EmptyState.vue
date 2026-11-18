<script setup lang="ts">
import type { Component } from 'vue';
import { PackageOpen } from 'lucide-vue-next';
defineProps<{ title: string; description: string; icon?: Component }>();
</script>
<template>
  <div class="empty-state">
    <div class="empty-icon">
      <component :is="icon || PackageOpen" :size="26" stroke-width="1.6" />
    </div>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <slot />
  </div>
</template>
