<script setup lang="ts">
defineProps<{ color?: string; size?: number }>();
</script>
<template>
  <svg :width="size || 64" :height="size || 64" viewBox="0 0 80 80" fill="none" aria-hidden="true">
    <ellipse cx="40" cy="68" rx="25" ry="4" fill="currentColor" opacity=".05" />
    <path d="M24 18h28v44H24z" :fill="color || '#8d84f4'" />
    <path
      d="M29 20v40M34 20v40M39 20v40M44 20v40M49 20v40"
      stroke="black"
      stroke-opacity=".12"
      stroke-width="2"
    />
    <ellipse
      cx="25"
      cy="40"
      rx="15"
      ry="28"
      fill="var(--spool-side,#e9eaf0)"
      stroke="var(--border,#dddfe7)"
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
