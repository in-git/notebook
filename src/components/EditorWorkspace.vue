<script setup lang="ts">
import { onMounted } from 'vue';
import {
  Copy,
  Delete,
  Magic,
  Setting as SettingIcon,
} from '@icon-park/vue-next';
import Quill from 'quill';
import ImageResize from 'quill-image-resize-module';
import type { Note, User as UserType } from '../types/note';

// 注册图片缩放模块（UMD 形式，npm 引入需手动注册到 Quill 实例）
Quill.register('modules/imageResize', ImageResize);

const props = defineProps<{
  currentNote?: Note;
  currentTitle: string;
  wordCount: number;
  isAiLoading: boolean;
  aiStatusText: string;
  aiDotColor: string;
  isTitleShimmering: boolean;
  aiSummaryInProgress: boolean;
  currentUser: UserType | null;
}>();

const emit = defineEmits([
  'update:currentTitle',
  'titleInput',
  'manualAiSummary',
  'openSettings',
  'copyNote',
  'deleteNote',
  'quillReady',
]);

// 图片转换为 webp 并上传
const loadImageEl = (file: File): Promise<HTMLImageElement> => {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
};

const convertToWebp = async (file: File, quality = 0.85): Promise<File> => {
  if (
    file.type === 'image/svg+xml' ||
    file.type === 'image/gif' ||
    file.type === 'image/webp'
  )
    return file;
  try {
    const img = await loadImageEl(file);
    const MAX_DIMENSION = 4096;
    let w = img.naturalWidth,
      h = img.naturalHeight;
    if (w > MAX_DIMENSION || h > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', quality),
    );
    if (!blob) return file;
    const baseName = (file.name || 'image').replace(/\.[^.]+$/, '');
    return new File([blob], `${baseName}.webp`, { type: 'image/webp' });
  } catch (e) {
    return file;
  }
};

onMounted(async () => {
  const quill = new Quill('#editor-container', {
    theme: 'snow',
    placeholder: '键入富文本内容，失焦后 AI 将自动总结标题...',
    modules: {
      toolbar: [
        ['bold', 'italic', 'underline', 'strike'],
        ['blockquote', 'code-block'],
        [{ header: 1 }, { header: 2 }],
        [{ list: 'ordered' }, { list: 'bullet' }],
        [{ color: [] }, { background: [] }],
        ['image'],
        ['clean'],
      ],
      imageResize: {},
    },
  });

  const uploadImageToServer = async (file: File) => {
    const uploadFile = await convertToWebp(file);
    const formData = new FormData();
    formData.append('image', uploadFile);
    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (data.url) {
        const range = quill.getSelection(true);
        quill.insertEmbed(range.index, 'image', data.url);
        quill.setSelection(range.index + 1);
      }
    } catch (error) {}
  };

  const toolbarModule = quill.getModule('toolbar') as {
    addHandler: (name: string, handler: () => void) => void;
  };
  toolbarModule.addHandler('image', () => {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.click();
    input.onchange = () => {
      if (input.files && input.files[0]) uploadImageToServer(input.files[0]);
    };
  });

  quill.root.addEventListener('paste', (event: ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.startsWith('image/')) {
        event.preventDefault();
        const file = items[i].getAsFile();
        if (file) uploadImageToServer(file);
        break;
      }
    }
  });

  emit('quillReady', quill);
});
</script>

<template>
  <div class="flex-1 h-full bg-white/20 flex flex-col relative">
    <!-- 浮动操作栏 -->
    <div
      v-if="currentNote"
      class="absolute top-4 right-4 z-10 bg-[rgba(255,255,255,0.75)]"
    >
      <div class="flex justify-end gap-3 items-center">
        <button
          class="bg-gradient-to-r from-[#e0e7ff] to-[#ede9fe] border border-[#c7d2fe]/60 px-[18px] py-[9px] rounded-xl text-sm font-medium cursor-pointer inline-flex items-center gap-1.5 text-[#6366f1] transition shadow-[0_1px_3px_rgba(99,102,241,0.08)] hover:shadow-[0_2px_8px_rgba(99,102,241,0.15)]"
          :class="{ 'ai-btn-loading': aiSummaryInProgress }"
          @click="emit('manualAiSummary')"
          title="AI 总结标题"
        >
          <magic theme="outline" size="15" :stroke-width="3" class="ai-icon" />
          AI 总结
        </button>
        <button
          class="bg-white/80 border border-black/[0.06] px-[18px] py-[9px] rounded-xl text-sm font-medium cursor-pointer inline-flex items-center gap-1.5 text-[#1d1d1f] transition shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:bg-white"
          @click="emit('openSettings')"
          title="设置"
        >
          <setting-icon theme="outline" size="15" :stroke-width="3" />
        </button>
        <button
          class="bg-white/80 border border-black/[0.06] px-[18px] py-[9px] rounded-xl text-sm font-medium cursor-pointer inline-flex items-center gap-1.5 text-[#1d1d1f] transition shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:bg-white"
          @click="emit('copyNote')"
          title="复制纯文本"
        >
          <copy theme="outline" size="15" :stroke-width="3" />
        </button>
        <button
          class="bg-white/80 border border-black/[0.06] px-[18px] py-[9px] rounded-xl text-sm font-medium cursor-pointer inline-flex items-center gap-1.5 text-[#1d1d1f] transition shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:bg-[#ff3b30] hover:text-white"
          @click="emit('deleteNote')"
          title="删除便签"
        >
          <delete theme="outline" size="15" :stroke-width="3" />
        </button>
      </div>
    </div>

    <!-- 编辑器主体 -->
    <div
      v-show="currentNote"
      class="h-full flex flex-col px-[60px] overflow-auto"
    >
      <div class="flex-1 flex flex-col gap-4 overflow-hidden pt-4">
        <input
          type="text"
          :value="currentTitle"
          @input="
            emit(
              'update:currentTitle',
              ($event.target as HTMLInputElement).value,
            );
            emit('titleInput');
          "
          class="text-[32px] pt-[12px] font-bold border-none bg-transparent outline-none text-[#1d1d1f] tracking-[-0.02em] placeholder-[#c7c7cc]"
          :class="{ 'title-shimmer': isTitleShimmering }"
          placeholder="无标题"
        />
        <div
          id="editor-container"
          class="flex-1 bg-transparent border-none flex flex-col overflow-auto"
        ></div>
      </div>
      <div
        class="flex justify-between items-center text-[13px] text-[#86868b] absolute bottom-8 right-8 gap-4 pb-2"
      >
        <div class="flex items-center gap-1.5">
          <span
            class="inline-block w-[6px] h-[6px] rounded-full"
            :class="{ 'ai-loading-dot': isAiLoading }"
            :style="{ backgroundColor: aiDotColor }"
          ></span>
          <span>{{ aiStatusText }}</span>
        </div>
        <div class="ml-4">{{ wordCount }} 字</div>
      </div>
    </div>

    <!-- 空状态 -->
    <div
      v-show="!currentNote"
      class="flex-1 h-full flex flex-col items-center justify-center text-[#86868b] gap-3"
    >
      <img
        src="/logo.png"
        alt="Logo"
        class="w-20 h-20 rounded-2xl shadow-[0_4px_16px_rgba(0,0,0,0.06)]"
      />
      <p class="text-[14px] mt-1">未选择便签</p>
      <p class="text-[12px] text-[#c7c7cc]">
        点击右上角 + 新建，或在设置中登录开启云同步
      </p>
    </div>
  </div>
</template>
