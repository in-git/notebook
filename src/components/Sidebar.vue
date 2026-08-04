<script setup lang="ts">
import {
  Add,
  Close,
  Logout,
  Pushpin,
  Search,
  Setting,
} from '@icon-park/vue-next';
import { computed } from 'vue';
import type { Note, User as UserType } from '../types/note';
import { NOTE_COLORS } from '../types/note';

const props = defineProps<{
  currentUser: UserType | null;
  cloudMode: boolean;
  searchKeyword: string;
  activeColorFilter: string | null;
  filteredNotes: Note[];
  currentNoteId: number | null;
}>();

const emit = defineEmits([
  'update:searchKeyword',
  'update:activeColorFilter',
  'logout',
  'createNote',
  'selectNote',
  'togglePin',
  'toggleColorPopover',
  'deleteNote',
  'dragStart',
  'dragEnd',
  'dragOver',
  'drop',
  'openSettings',
]);

const isLoggedIn = computed(() => !!props.currentUser);
// cloudMode prop 保留供未来扩展，当前未在侧栏使用

const colorFilters = computed(() => [
  { name: '全部', filter: null, hex: null },
  ...NOTE_COLORS.map((c) => ({
    name: c.name,
    filter: c.value === null ? 'default' : c.value,
    hex: c.hex,
  })),
]);

const getNoteColorHex = (note?: Note) =>
  note ? note.color || '#eeeeee' : '#eeeeee';

const getPlainSnippet = (htmlBody: string) => {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlBody || '';
  return (tempDiv.textContent || tempDiv.innerText || '').trim();
};
</script>

<template>
  <div
    class="w-80 h-full bg-[rgba(255,255,255,0.5)] border-r border-black/[0.06] flex flex-col backdrop-blur-[20px]"
  >
    <!-- 用户信息条 / 登录入口 -->
    <div class="px-4 pt-4 pb-2 flex items-center justify-between">
      <div class="flex items-center gap-2 min-w-0 flex-1">
        <template v-if="isLoggedIn">
          <div
            class="w-8 h-8 rounded-full bg-[#0071e3]/10 text-[#0071e3] flex items-center justify-center text-[14px] font-semibold shrink-0"
          >
            {{ (currentUser?.username || '?').charAt(0).toUpperCase() }}
          </div>
          <span class="text-[14px] text-[#1d1d1f] truncate">{{
            currentUser?.username
          }}</span>
        </template>
        <template v-else>
          <img
            src="/logo.png"
            alt="Logo"
            class="w-8 h-8 rounded-lg shrink-0 shadow-[0_1px_3px_rgba(0,0,0,0.08)]"
          />
          <span class="text-[14px] text-[#86868b]">未登录 · 本地模式</span>
        </template>
      </div>
      <div class="flex items-center gap-1">
        <button
          @click="emit('openSettings')"
          title="设置"
          class="text-[#86868b] hover:text-[#0071e3] w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#0071e3]/10 transition"
        >
          <setting theme="outline" size="16" :stroke-width="3" />
        </button>
        <button
          v-if="isLoggedIn"
          @click="emit('logout')"
          title="退出登录"
          class="text-[#86868b] hover:text-[#ff3b30] w-8 h-8 rounded-full flex items-center justify-center hover:bg-[#ff3b30]/10 transition"
        >
          <logout theme="outline" size="16" :stroke-width="3" />
        </button>
      </div>
    </div>

    <!-- 搜索框 + 新建按钮 -->
    <div class="px-4 pt-4 pb-4 flex gap-3 items-center">
      <div class="flex-1 relative">
        <search
          theme="outline"
          size="15"
          :stroke-width="3"
          class="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b] pointer-events-none"
        />
        <input
          type="text"
          :value="searchKeyword"
          @input="
            emit(
              'update:searchKeyword',
              ($event.target as HTMLInputElement).value,
            )
          "
          placeholder="搜索便签"
          class="w-full bg-black/[0.04] border-none rounded-xl pl-9 pr-3 py-[7px] text-[14px] text-[#1d1d1f] placeholder-[#86868b] outline-none focus:bg-black/[0.06] transition"
        />
      </div>
      <button
        class="shrink-0 relative z-2 bg-transparent border-none cursor-pointer w-9 h-9 rounded-full flex items-center justify-center text-[#0071e3] transition hover:bg-[#0071e3]/10"
        @click="emit('createNote')"
        title="新建便签"
      >
        <add theme="outline" size="22" :stroke-width="3" />
      </button>
    </div>

    <!-- 颜色筛选条 -->
   <div class="px-4 py-3 ">
     <div
      class="flex justify-between items-center px-2"
    >
      <button
        v-for="f in colorFilters"
        :key="f.name"
        class="shrink-0 w-5 h-5 rounded-full border border-black/10 transition-transform hover:scale-110"
        :class="{
          'ring-2 ring-offset-1 ring-[#1d1d1f] scale-110':
            activeColorFilter === f.filter,
        }"
        :title="f.name"
        :style="{
          background:
            f.hex === null
              ? 'conic-gradient(from 90deg, #FF3B30, #FF9500, #FFCC00, #34C759, #007AFF, #AF52DE, #FF3B30)'
              : f.hex,
        }"
        @click.stop="emit('update:activeColorFilter', f.filter)"
      ></button>
    </div>

   </div>
    <!-- 列表区 -->
    <div class="flex-1 overflow-y-auto px-4 pb-4">
      <div
        v-if="filteredNotes.length === 0"
        class="text-center text-[14px] text-[#86868b] py-10"
      >
        {{
          searchKeyword || activeColorFilter !== null
            ? '未找到匹配的便签'
            : '暂无便签'
        }}
      </div>
      <div
        v-for="note in filteredNotes"
        :key="note.id"
        class="p-4 pl-5 rounded-xl cursor-pointer mb-2 transition-all relative flex justify-between items-center group"
        :class="
          note.id === currentNoteId
            ? 'bg-white shadow-[0_4px_16px_rgba(0,0,0,0.04)]'
            : 'bg-transparent hover:bg-white/60'
        "
        draggable="true"
        @dragstart="emit('dragStart', $event, note)"
        @dragend="emit('dragEnd', $event)"
        @dragover.prevent="emit('dragOver', $event, note)"
        @drop="emit('drop', $event, note)"
        @click="emit('selectNote', note.id)"
      >
        <span
          class="absolute left-1.5 top-4 bottom-4 w-[3px] rounded-full"
          :style="{
            background: getNoteColorHex(note),
            boxShadow:
              getNoteColorHex(note) === '#FFFFFF'
                ? 'inset 0 0 0 1px rgba(0,0,0,0.15)'
                : 'none',
          }"
        ></span>

        <div class="flex-1 overflow-hidden mr-2">
          <div
            class="text-[15px] font-semibold text-[#1d1d1f] whitespace-nowrap overflow-hidden text-ellipsis mb-1 flex items-center"
          >
            <span
              v-if="note.pinned"
              class="text-[#ff9500] inline-block mr-1 flex-shrink-0 w-3.5 h-3.5"
            >
              <pushpin
                theme="filled"
                size="14"
                :stroke-width="3"
                class="text-[#ff9500]"
              />
            </span>
            <span class="truncate">{{ note.title || '无标题' }}</span>
          </div>
          <div
            class="text-[14px] text-[#86868b] whitespace-nowrap overflow-hidden text-ellipsis"
          >
            {{ getPlainSnippet(note.body) || '无内容' }}
          </div>
        </div>

        <div class="flex items-center gap-0.5">
          <button
            class="bg-transparent border-none cursor-pointer w-7 h-7 rounded-full flex items-center justify-center transition hover:bg-black/5"
            :class="
              note.id === currentNoteId
                ? 'opacity-70 hover:opacity-100'
                : 'opacity-0 group-hover:opacity-100'
            "
            title="颜色分类"
            @click.stop="emit('toggleColorPopover', $event, note.id)"
          >
            <span
              class="inline-block w-3.5 h-3.5 rounded-full border border-black/10"
              :style="{ background: getNoteColorHex(note) }"
            ></span>
          </button>
          <button
            class="bg-transparent border-none text-[#86868b] cursor-pointer w-7 h-7 rounded-full flex items-center justify-center transition hover:bg-[#ff9500]/10 hover:text-[#ff9500]"
            :class="
              note.id === currentNoteId
                ? 'opacity-70 hover:opacity-100'
                : 'opacity-0 group-hover:opacity-100'
            "
            :title="note.pinned ? '取消置顶' : '置顶'"
            @click.stop="emit('togglePin', note.id)"
          >
            <pushpin
              :theme="note.pinned ? 'filled' : 'outline'"
              size="14"
              :stroke-width="3"
            />
          </button>
        </div>
        <button
          class="absolute top-1 right-1 bg-transparent border-none text-[#86868b] cursor-pointer w-5 h-5 rounded-full flex items-center justify-center transition hover:bg-[#ff3b30]/10 hover:text-[#ff3b30]"
          :class="
            note.id === currentNoteId
              ? 'opacity-50 hover:opacity-100'
              : 'opacity-0 group-hover:opacity-100'
          "
          title="删除便签"
          @click.stop="emit('deleteNote', note.id)"
        >
          <close theme="outline" size="12" :stroke-width="4" />
        </button>
      </div>
    </div>
  </div>
</template>
