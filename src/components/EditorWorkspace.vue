<script setup lang="ts">
import { onMounted, ref, onUnmounted } from 'vue';
import {
  Copy,
  Delete,
  Magic,
  Picture as PictureIcon,
  Setting as SettingIcon,
} from '@icon-park/vue-next';
import { AiEditor } from 'aieditor';
import 'aieditor/dist/style.css';
import { businessApi } from '../lib/api';
import { getToken } from '../lib/storage';
import type { Note, User as UserType } from '../types/note';

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
  cloudMode: boolean;
}>();

const emit = defineEmits([
  'update:currentTitle',
  'titleInput',
  'manualAiSummary',
  'openSettings',
  'openImageTools',
  'copyNote',
  'deleteNote',
  'aiEditorReady',
]);

// 上传错误提示
const uploadError = ref('');

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

// 文件转 base64 dataURL（未登录时图片内嵌到内容，纯本地保存）
const fileToDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

let aiEditor: AiEditor | null = null;

onMounted(async () => {
  aiEditor = new AiEditor({
    element: '#editor-container',
    placeholder: '键入富文本内容，失焦后 AI 将自动总结标题...',
    content: '',
    image: {
      // 自定义上传：登录走云端 businessApi.upload；未登录转 base64 内嵌（纯本地保存）
      // uploader 签名：(file, uploadUrl, headers, formName) => Promise<Record<string, any>>
      // AiEditor 期望返回 { errorCode: 0, data: { src, href } }
      uploader: async (file: File) => {
        try {
          // 上传前做 webp 压缩（减小体积，base64 模式同样受益）
          const processed = await convertToWebp(file);

          // 未登录：转 base64 内嵌，数据完全保存在本地
          if (!getToken()) {
            const dataUrl = await fileToDataUrl(processed);
            return { errorCode: 0, data: { src: dataUrl, href: dataUrl } };
          }

          // 已登录：上传到云端
          const resp = (await businessApi.upload(processed)) as Record<string, unknown>;
          // 适配后端响应：兼容多种字段名
          const inner = (resp.data || resp.result || resp) as Record<string, unknown>;
          const src =
            (typeof inner.src === 'string' && inner.src) ||
            (typeof inner.url === 'string' && inner.url) ||
            (typeof inner.href === 'string' && inner.href) ||
            (typeof resp.url === 'string' && resp.url) ||
            (typeof resp.src === 'string' && resp.src) ||
            '';
          if (!src) {
            return { errorCode: 1, errorMsg: '上传成功但未返回图片地址' };
          }
          // 若返回相对路径，拼接 baseURL
          const fullSrc = src.startsWith('http')
            ? src
            : (import.meta.env.VITE_API_BASE ||
                (import.meta.env.DEV
                  ? 'http://localhost:82'
                  : 'https://aab2b9dab7609fdb2.sh7.agentos-app.net/api')) +
              (src.startsWith('/') ? src : '/' + src);
          return { errorCode: 0, data: { src: fullSrc, href: fullSrc } };
        } catch (e) {
          const msg = e instanceof Error ? e.message : '图片上传失败';
          return { errorCode: 1, errorMsg: msg };
        }
      },
    },
    onCreated: () => {
      // 将 AiEditor 实例本身传给父组件（注意：不是回调参数里的 editor）
      emit('aiEditorReady', aiEditor);
    },
  });
});

onUnmounted(() => {
  aiEditor?.destroy();
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
          @click="emit('openImageTools')"
          title="图片处理"
        >
          <picture-icon theme="outline" size="15" :stroke-width="3" />
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
      class="h-full flex flex-col px-4 overflow-auto"
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
          class="flex-1 bg-transparent border-none flex flex-col overflow-auto aieditor-container"
        ></div>
      </div>
      <div
        class="flex justify-between items-center text-[14px] text-[#86868b] absolute bottom-8 right-8 gap-4 pb-2"
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
      <p class="text-[14px] text-[#c7c7cc]">
        点击右上角 + 新建，或在设置中登录开启云同步
      </p>
    </div>
  </div>
</template>
