<script setup lang="ts">
import { useId } from 'vue';

withDefaults(defineProps<{ color?: string; size?: number }>(), { color: '#8d84f4', size: 64 });
const sheen = useId();
const winding = 'M20 29H76V64C76 78 20 78 20 64Z';
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 96 96" fill="none" aria-hidden="true">
    <defs>
      <linearGradient :id="sheen" x2="1" y2=".12">
        <stop stop-color="#0e1715" stop-opacity=".22" />
        <stop offset=".32" stop-color="#fff" stop-opacity=".18" />
        <stop offset=".59" stop-color="#fff" stop-opacity="0" />
        <stop offset="1" stop-color="#0e1715" stop-opacity=".26" />
      </linearGradient>
    </defs>

    <g transform="rotate(-12 48 48)">
      <!-- Both flanges share the same profile and axis. -->
      <g fill="var(--spool-side)">
        <path d="M13 64H83V67C83 75 67 81 48 81S13 75 13 67Z" />
        <ellipse cx="48" cy="64" rx="35" ry="14" fill="var(--spool-front)" />
      </g>
      <path :d="winding" :fill="color" />
      <path :d="winding" :fill="`url(#${sheen})`" />
      <g stroke-linecap="round" stroke-width="1.25">
        <path
          v-for="y in [38, 45, 52, 59]"
          :key="y"
          d="M0 0C3 9 41 14 54 2"
          :transform="`translate(21 ${y})`"
          stroke="#15201c"
          stroke-opacity=".16"
        />
      </g>

      <path d="M13 26H83V29C83 37 67 43 48 43S13 37 13 29Z" fill="var(--spool-side)" />
      <ellipse
        cx="48"
        cy="26"
        rx="35"
        ry="14"
        fill="var(--spool-front)"
        stroke="var(--spool-side)"
        stroke-width=".9"
      />
      <ellipse cx="48" cy="26" rx="11.5" ry="5.2" fill="#34423d" />
      <path d="M36.5 26a11.5 5.2 0 0 1 23 0c-4-3.8-19-3.8-23 0Z" fill="#192722" />
    </g>
  </svg>
</template>
