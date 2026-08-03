<script setup lang="ts">
defineProps<{
  show: boolean;
  title: string;
  message: string;
}>();

const emit = defineEmits(['close']);
</script>

<template>
  <div
    class="absolute inset-0 bg-black/30 backdrop-blur-[4px] flex items-center justify-center z-[300] transition-opacity duration-200"
    :class="
      show ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
    "
    @click="emit('close')"
  >
    <div
      class="bg-white/95 backdrop-blur-[20px] rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] w-[320px] overflow-hidden"
      @click.stop
    >
      <div class="px-6 pt-6 pb-2 text-center">
        <div class="text-[15px] font-medium text-[#1d1d1f] leading-relaxed">
          {{ title }}
        </div>
      </div>
      <div class="px-6 pb-2 text-center">
        <div class="text-[13px] text-[#86868b] leading-relaxed">
          {{ message }}
        </div>
      </div>
      <div class="px-6 pb-5 pt-3 flex justify-center">
        <button
          @click="emit('close')"
          class="bg-[#0071e3] text-white border-none px-8 py-2.5 rounded-xl text-[15px] font-medium cursor-pointer transition hover:bg-[#0062cc] min-w-[120px]"
        >
          好的
        </button>
      </div>
    </div>
  </div>
</template>
