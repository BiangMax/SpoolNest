<script setup lang="ts">
defineProps<{ color?: string; size?: number }>();
</script>
<template>
  <svg :width="size || 64" :height="size || 64" viewBox="0 0 80 80" fill="none" aria-hidden="true">
    <ellipse cx="40" cy="68" rx="25" ry="4" fill="currentColor" opacity=".05" />
    <!-- Paint back to front: rear flange, wound filament, then front flange. -->
    <ellipse
      cx="25"
      cy="40"
      rx="15"
      ry="28"
      fill="var(--spool-side,#e9eaf0)"
      stroke="var(--border,#dddfe7)"
    />
    <path d="M25 18H54A10 22 0 0 1 54 62H25A10 22 0 0 1 25 18Z" :fill="color || '#8d84f4'" />
    <path
      d="M25 18C12 18 12 62 25 62M30 18C17 18 17 62 30 62M35 18C22 18 22 62 35 62M40 18C27 18 27 62 40 62M45 18C32 18 32 62 45 62M50 18C37 18 37 62 50 62"
      stroke="black"
      stroke-opacity=".12"
      stroke-width="1"
    />
    <ellipse
      cx="54"
      cy="40"
      rx="15"
      ry="28"
      fill="var(--spool-front,#f8f9fb)"
      stroke="var(--border,#dddfe7)"
    />
    <ellipse
      cx="54"
      cy="40"
      rx="10"
      ry="22"
      :fill="color || '#8d84f4'"
      stroke="black"
      stroke-opacity=".08"
    />
    <ellipse
      cx="54"
      cy="40"
      rx="4"
      ry="8"
      fill="var(--spool-side,#e9eaf0)"
      stroke="black"
      stroke-opacity=".1"
    />
    <path d="M62 57v10" :stroke="color || '#8d84f4'" stroke-width="3" stroke-linecap="round" />
  </svg>
</template>
