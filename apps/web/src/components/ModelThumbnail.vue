<script setup lang="ts">
import { ref, watch } from 'vue';
import { Box } from 'lucide-vue-next';
import type { Job } from '../../../../packages/shared/src';
import { api } from '../lib/api';
import { useWorkspace } from '../lib/store';

const props = defineProps<{ job: Job }>();
const store = useWorkspace();
const src = ref<string | null>(null);
const image = ref<HTMLImageElement | null>(null);
const loaded = ref(false);
let triedRefresh = false;
watch(
  [() => props.job.id, () => props.job.thumbnail],
  () => {
    src.value = props.job.thumbnail;
    loaded.value = false;
    triedRefresh = false;
  },
  { immediate: true },
);

async function onError(event: Event) {
  const failedImage = event.currentTarget;
  if (image.value !== failedImage) return;
  loaded.value = false;
  if (
    !triedRefresh &&
    props.job.source === 'bambu_cloud' &&
    store.data?.sync.enabled &&
    store.data.sync.configured
  ) {
    triedRefresh = true;
    const result = await api<{ thumbnail: string | null }>(`/jobs/${props.job.id}/thumbnail`).catch(
      () => null,
    );
    if (image.value !== failedImage) return;
    if (result?.thumbnail && result.thumbnail !== src.value) {
      src.value = result.thumbnail;
      return;
    }
  }
  src.value = null;
}
</script>
<template>
  <span class="model-thumbnail" aria-hidden="true">
    <Box v-if="!loaded" :size="24" :stroke-width="1.5" />
    <img
      v-if="src"
      :key="src"
      ref="image"
      :src="src"
      :class="{ loaded }"
      alt=""
      loading="lazy"
      referrerpolicy="no-referrer"
      @load="loaded = true"
      @error="onError"
    />
  </span>
</template>
