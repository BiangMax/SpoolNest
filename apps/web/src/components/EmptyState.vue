<script setup lang="ts">
import { PackageOpen } from 'lucide-vue-next';
defineProps<{ title: string; description: string }>();
</script>
<template>
  <div class="empty-state">
    <div class="empty-icon"><PackageOpen :size="27" stroke-width="1.4" /></div>
    <h3>{{ title }}</h3>
    <p>{{ description }}</p>
    <slot />
  </div>
</template>
