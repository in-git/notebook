<script setup lang="ts">
import type { Note } from '../types/note';
import { NOTE_COLORS } from '../types/note';

defineProps<{
  show: boolean;
  top: number;
  left: number;
  noteId: number | null;
  notes: Note[];
}>();

const emit = defineEmits(['setColor']);

const getNoteColorHex = (note?: Note) =>
  note ? note.color || '#eeeeee' : '#eeeeee';
</script>

<template>
  <div
    v-if="show"
    class="fixed z-[9999] bg-white/80 backdrop-blur-xl border border-white/60 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] p-2 flex items-center gap-1.5"
    :style="{ top: top + 'px', left: left + 'px' }"
    @click.stop
  >
    <button
      v-for="c in NOTE_COLORS"
      :key="c.name"
      class="w-6 h-6 rounded-full border border-black/10 transition-transform hover:scale-110"
      :class="{
        'ring-2 ring-offset-1 ring-[#1d1d1f] scale-110':
          getNoteColorHex(notes.find((n) => n.id === noteId)) === c.hex,
      }"
      :style="{ background: c.hex }"
      :title="c.name"
      @click="emit('setColor', noteId, c.value)"
    ></button>
  </div>
</template>
