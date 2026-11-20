<script setup lang="ts">
import { Box } from 'lucide-vue-next';
defineProps<{ model: string }>();
</script>
<template>
  <svg
    v-if="model === 'A1 mini' || model === 'X2D'"
    class="printer-drawing"
    viewBox="0 0 120 92"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linejoin="round"
    stroke-linecap="round"
    aria-hidden="true"
  >
    <g v-if="model === 'A1 mini'">
      <path class="machine-shade" d="m12 67 48-10 41 12-47 14z M12 67v6l42 14 47-13v-5M54 83v4" />
      <path class="machine-shade" d="m78 62 1-47 7-2 6 2-1 49-7 2z M79 15l6 2 7-2m-7 2-1 49" />
      <path d="m29 35 49-10 7 2-50 11z M29 35v5l6 3 50-11v-5m-50 11v5" />
      <path
        class="machine-shade"
        d="m42 32 12-3 7 3v13l-12 3-7-4z M42 32l7 3 12-3m-12 3v13m2 0 2 4 2-5"
      />
      <path d="m22 62 36-8 24 7-36 10z M22 62v3l24 9 36-10v-3M54 29c0-12 11-19 18-18 5 0 9 4 9 9" />
    </g>
    <g v-else>
      <path class="machine-shade" d="m24 17 49-7 26 10v53l-49 11-26-14z" />
      <path d="m24 17 26 10 49-7M50 27v57m-21-61 16 7v43l-16-7z M56 32l37-6v42l-37 8z" />
      <path
        d="m60 61 22-5 8 3-24 6z M61 40l27-5m-15 0 7-1v8l-7 1z M76 43v3m-21-25 15-2 5 2-15 3z"
      />
    </g>
  </svg>
  <Box v-else :size="46" :stroke-width="1.3" aria-hidden="true" />
</template>
