<script setup lang="ts">
defineProps<{ title: string; description?: string; count?: number }>();
</script>
<template>
  <header class="page-heading">
    <div>
      <h1>
        {{ title }} <span v-if="count !== undefined" class="heading-count">{{ count }}</span>
      </h1>
      <p v-if="description">{{ description }}</p>
      <slot name="meta" />
    </div>
    <div v-if="$slots.default" class="actions"><slot /></div>
  </header>
</template>
