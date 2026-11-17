<script setup lang="ts">
import {
  DialogRoot,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from 'reka-ui';
import { X } from 'lucide-vue-next';
defineProps<{
  open: boolean;
  title: string;
  description?: string;
  drawer?: boolean;
  wide?: boolean;
}>();
defineEmits<{ 'update:open': [boolean] }>();
</script>
<template>
  <DialogRoot :open="open" @update:open="$emit('update:open', $event)"
    ><DialogPortal
      ><DialogOverlay class="modal-overlay" /><DialogContent class="modal" :class="{ drawer, wide }"
        ><header class="modal-header">
          <div>
            <DialogTitle class="modal-title">{{ title }}</DialogTitle><DialogDescription
              class="muted"
              >{{ description || '修改后保存，取消不会改变数据。' }}</DialogDescription
            >
          </div>
          <DialogClose class="icon-button" aria-label="关闭"><X :size="19" /></DialogClose>
        </header>
        <div class="modal-body"><slot /></div>
        <footer v-if="$slots.footer" class="modal-footer">
          <slot name="footer" /></footer></DialogContent></DialogPortal
  ></DialogRoot>
</template>
