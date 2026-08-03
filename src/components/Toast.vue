<script setup lang="ts">
defineProps<{
  show: boolean;
  message: string;
}>();
</script>

<template>
  <div
    class="fixed z-[1000] bottom-10 left-1/2 -translate-x-1/2 bg-black/80 text-white px-6 py-3 rounded-full text-sm backdrop-blur-[10px] transition-all duration-300 pointer-events-none"
    :class="
      show ? 'translate-y-0 opacity-100' : 'translate-y-[100px] opacity-0'
    "
  >
    {{ message }}
  </div>
</template>
