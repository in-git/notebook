<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Close, Download, Picture, Upload } from '@icon-park/vue-next';

// ========== 图片加载 ==========
const loadImageEl = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

// ========== 输入图片 ==========
const origFile = ref<File | null>(null);
const origUrl = ref('');
const origW = ref(0);
const origH = ref(0);
const origSize = ref(0); // bytes
const errorMsg = ref('');

const onPick = (e: Event) => {
  const input = e.target as HTMLInputElement;
  const f = input.files?.[0];
  if (f) setFile(f);
  input.value = '';
};

const onDrop = (e: DragEvent) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) setFile(f);
};

const setFile = async (f: File) => {
  errorMsg.value = '';
  if (!f.type.startsWith('image/')) {
    errorMsg.value = '请选择图片文件';
    return;
  }
  origFile.value = f;
  origUrl.value = URL.createObjectURL(f);
  origSize.value = f.size;
  try {
    const img = await loadImageEl(origUrl.value);
    origW.value = img.naturalWidth;
    origH.value = img.naturalHeight;
  } catch {
    errorMsg.value = '图片加载失败';
  }
  // 重置选项为推荐值
  qualityIdx.value = 1; // 75%
  resizeIdx.value = 0; // 原始
  runProcess();
};

// ========== 压缩质量网格 ==========
// 候选项：100% / 75% / 50%，75% 标“推荐”
const qualityOptions = [
  { label: '100%', value: 1.0, recommend: false },
  { label: '75%', value: 0.75, recommend: true },
  { label: '50%', value: 0.5, recommend: false },
];
const qualityIdx = ref(1);
// 滑块映射到 0~100，对应 0.1~1.0
const qualitySlider = ref(75);
watch(qualitySlider, (v) => {
  qualityIdx.value = -1; // 滑块手动调整时取消网格高亮
  runProcess();
});
const selectQuality = (i: number) => {
  qualityIdx.value = i;
  qualitySlider.value = Math.round(qualityOptions[i].value * 100);
  runProcess();
};
const currentQuality = computed(() => qualitySlider.value / 100);

// ========== 缩放尺寸网格 ==========
// 常见设备尺寸候选项
const resizeOptions = [
  { label: '原始', w: 0, h: 0, note: '保持原尺寸' },
  { label: '1080p', w: 1920, h: 1080, note: 'Full HD' },
  { label: '2K', w: 2560, h: 1440, note: 'QHD' },
  { label: '4K', w: 3840, h: 2160, note: 'UHD' },
  { label: 'iPad', w: 2048, h: 1536, note: 'Retina' },
  { label: 'iPhone', w: 1170, h: 2532, note: 'Pro Max' },
  { label: '微信封面', w: 900, h: 383, note: '公众号' },
  { label: '方形', w: 1080, h: 1080, note: '1:1' },
];
const resizeIdx = ref(0);
// 滑块：按最长边缩放百分比 10%~100%
const resizeSlider = ref(100);
watch(resizeSlider, () => {
  resizeIdx.value = -1;
  runProcess();
});
const selectResize = (i: number) => {
  resizeIdx.value = i;
  const opt = resizeOptions[i];
  if (opt.w === 0) {
    resizeSlider.value = 100;
  } else {
    // 按候选项最长边占原始最长边的百分比
    const maxOrig = Math.max(origW.value, origH.value) || 1;
    const maxTarget = Math.max(opt.w, opt.h);
    resizeSlider.value = Math.max(10, Math.min(100, Math.round((maxTarget / maxOrig) * 100)));
  }
  runProcess();
};

// ========== 处理结果 ==========
const resultUrl = ref('');
const resultSize = ref(0);
const resultW = ref(0);
const resultH = ref(0);
const processing = ref(false);

const formatSize = (b: number): string => {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / 1024 / 1024).toFixed(2)} MB`;
};

const ratioPct = computed(() => {
  if (!origSize.value || !resultSize.value) return 0;
  return Math.round((1 - resultSize.value / origSize.value) * 100);
});

// 目标输出尺寸（按候选项或滑块百分比）
const targetSize = computed(() => {
  if (!origW.value || !origH.value) return { w: 0, h: 0 };
  // 优先使用网格候选项（非“原始”）
  if (resizeIdx.value > 0) {
    const opt = resizeOptions[resizeIdx.value];
    return fitInto(origW.value, origH.value, opt.w, opt.h);
  }
  // 否则用滑块百分比（按最长边）
  const pct = resizeSlider.value / 100;
  const maxOrig = Math.max(origW.value, origH.value);
  const maxTarget = Math.round(maxOrig * pct);
  return scaleToMax(origW.value, origH.value, maxTarget);
});

// 等比缩放到目标最长边
function scaleToMax(w: number, h: number, maxTarget: number) {
  const maxOrig = Math.max(w, h) || 1;
  const s = maxTarget / maxOrig;
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

// 等比缩放使图片“放入”目标框（不超过 w×h，保持比例）
function fitInto(w: number, h: number, tw: number, th: number) {
  const s = Math.min(tw / w, th / h);
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

// 执行压缩+缩放（canvas → webp）
const runProcess = async () => {
  if (!origFile.value || !origUrl.value) return;
  processing.value = true;
  try {
    const img = await loadImageEl(origUrl.value);
    const tw = targetSize.value.w || img.naturalWidth;
    const th = targetSize.value.h || img.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, tw, th);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/webp', currentQuality.value),
    );
    if (!blob) return;
    if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
    resultUrl.value = URL.createObjectURL(blob);
    resultSize.value = blob.size;
    resultW.value = tw;
    resultH.value = th;
  } catch {
    // 忽略
  } finally {
    processing.value = false;
  }
};

// 防抖
let timer: number | null = null;
watch([qualitySlider, resizeSlider], () => {
  if (timer) clearTimeout(timer);
  timer = window.setTimeout(runProcess, 200);
});

// ========== 下载 ==========
const onDownload = () => {
  if (!resultUrl.value) return;
  const a = document.createElement('a');
  a.href = resultUrl.value;
  const base = (origFile.value?.name || 'image').replace(/\.[^.]+$/, '');
  a.download = `${base}_processed.webp`;
  a.click();
};

// ========== 弹窗显隐 ==========
const props = defineProps<{ show: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const reset = () => {
  if (origUrl.value) URL.revokeObjectURL(origUrl.value);
  if (resultUrl.value) URL.revokeObjectURL(resultUrl.value);
  origFile.value = null;
  origUrl.value = '';
  origW.value = 0;
  origH.value = 0;
  origSize.value = 0;
  resultUrl.value = '';
  resultSize.value = 0;
  resultW.value = 0;
  resultH.value = 0;
  errorMsg.value = '';
};
watch(
  () => props.show,
  (v) => {
    if (!v) reset();
  },
);
</script>

<template>
  <div
    class="absolute inset-0 bg-black/30 backdrop-blur-[4px] flex items-center justify-center z-[200] transition-opacity duration-200"
    :class="show ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'"
    @click="emit('close')"
  >
    <div
      class="bg-white/95 backdrop-blur-[20px] rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] w-[760px] max-w-[94vw] max-h-[90vh] overflow-hidden flex flex-col"
      @click.stop
    >
      <!-- 头部 -->
      <div class="px-6 pb-4 flex justify-between items-center border-b border-black/[0.06] shrink-0">
        <h3 class="text-lg font-semibold text-[#1d1d1f] flex items-center gap-2">
          <picture theme="outline" size="20" :stroke-width="3" class="text-[#0071e3]" />
          图片处理
        </h3>
        <button
          @click="emit('close')"
          class="bg-transparent border-none cursor-pointer w-7 h-7 rounded-full flex items-center justify-center text-[#86868b] hover:bg-black/5 transition"
        >
          <close theme="outline" size="16" :stroke-width="3" />
        </button>
      </div>

      <div class="px-6 py-5 overflow-y-auto">
        <!-- 无图片：上传区 -->
        <div
          v-if="!origFile"
          class="border-2 border-dashed border-black/10 rounded-2xl py-16 flex flex-col items-center justify-center gap-3 cursor-pointer hover:border-[#0071e3]/40 hover:bg-[#0071e3]/[0.02] transition"
          @click="($refs.fileInput as HTMLInputElement).click()"
          @dragover.prevent
          @drop="onDrop"
        >
          <upload theme="outline" size="40" :stroke-width="2" class="text-[#86868b]" />
          <p class="text-[14px] text-[#1d1d1f] font-medium">点击或拖拽图片到此处</p>
          <p class="text-[14px] text-[#86868b]">支持 JPG / PNG / WebP，输出 WebP</p>
          <input ref="fileInput" type="file" accept="image/*" class="hidden" @change="onPick" />
          <p v-if="errorMsg" class="text-[14px] text-[#ff3b30]">{{ errorMsg }}</p>
        </div>

        <!-- 有图片：处理面板 -->
        <div v-else class="grid grid-cols-2 gap-6">
          <!-- 左：预览 -->
          <div class="flex flex-col gap-3">
            <div class="text-[14px] font-medium text-[#1d1d1f]">预览</div>
            <div class="bg-black/[0.03] rounded-xl p-3 flex items-center justify-center min-h-[240px]">
              <img
                v-if="resultUrl"
                :src="resultUrl"
                alt="预览"
                class="max-w-full max-h-[280px] object-contain rounded-lg"
              />
              <span v-else class="text-[14px] text-[#86868b]">处理中...</span>
            </div>
            <!-- 原图 vs 结果 -->
            <div class="text-[14px] text-[#86868b] space-y-1">
              <div class="flex justify-between">
                <span>原始</span>
                <span>{{ origW }}×{{ origH }} · {{ formatSize(origSize) }}</span>
              </div>
              <div class="flex justify-between" :class="ratioPct > 0 ? 'text-[#34c759]' : 'text-[#ff9500]'">
                <span>结果</span>
                <span>
                  {{ resultW }}×{{ resultH }} · {{ formatSize(resultSize) }}
                  <span v-if="ratioPct > 0">（-{{ ratioPct }}%）</span>
                  <span v-else-if="ratioPct < 0">（+{{ Math.abs(ratioPct) }}%）</span>
                </span>
              </div>
            </div>
            <button
              @click="onDownload"
              :disabled="!resultUrl"
              class="w-full bg-[#0071e3] text-white rounded-xl py-2.5 text-[14px] font-medium hover:bg-[#0077ed] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5"
            >
              <download theme="outline" size="14" :stroke-width="3" />
              下载 WebP
            </button>
          </div>

          <!-- 右：参数 -->
          <div class="flex flex-col gap-5">
            <!-- 压缩质量 -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-[14px] font-medium text-[#1d1d1f]">压缩质量</span>
                <span class="text-[14px] text-[#0071e3] font-medium">{{ qualitySlider }}%</span>
              </div>
              <!-- 网格候选项 -->
              <div class="grid grid-cols-3 gap-2 mb-3">
                <button
                  v-for="(opt, i) in qualityOptions"
                  :key="opt.label"
                  @click="selectQuality(i)"
                  class="relative py-2.5 rounded-xl text-[14px] font-medium transition border"
                  :class="
                    qualityIdx === i
                      ? 'bg-[#0071e3]/10 text-[#0071e3] border-[#0071e3]/40'
                      : 'bg-black/[0.03] text-[#1d1d1f] border-transparent hover:bg-black/[0.06]'
                  "
                >
                  {{ opt.label }}
                  <span
                    v-if="opt.recommend"
                    class="absolute -top-2 -right-1 bg-[#ff9500] text-white text-[14px] px-1.5 py-0.5 rounded-full leading-none whitespace-nowrap"
                    >推荐</span
                  >
                </button>
              </div>
              <!-- 滑块 -->
              <input
                v-model.number="qualitySlider"
                type="range"
                min="10"
                max="100"
                step="1"
                class="w-full accent-[#0071e3] cursor-pointer"
              />
              <div class="flex justify-between text-[14px] text-[#86868b] mt-0.5">
                <span>10%</span><span>100%</span>
              </div>
            </div>

            <!-- 图片缩放 -->
            <div>
              <div class="flex items-center justify-between mb-2">
                <span class="text-[14px] font-medium text-[#1d1d1f]">图片缩放</span>
                <span class="text-[14px] text-[#0071e3] font-medium">{{ resizeSlider }}%</span>
              </div>
              <!-- 网格候选项 -->
              <div class="grid grid-cols-4 gap-2 mb-3">
                <button
                  v-for="(opt, i) in resizeOptions"
                  :key="opt.label"
                  @click="selectResize(i)"
                  class="py-2 px-1 rounded-xl text-[14px] font-medium transition border flex flex-col items-center gap-0.5"
                  :class="
                    resizeIdx === i
                      ? 'bg-[#0071e3]/10 text-[#0071e3] border-[#0071e3]/40'
                      : 'bg-black/[0.03] text-[#1d1d1f] border-transparent hover:bg-black/[0.06]'
                  "
                >
                  <span>{{ opt.label }}</span>
                  <span class="text-[14px] text-[#86868b] font-normal">{{ opt.note }}</span>
                </button>
              </div>
              <!-- 滑块 -->
              <input
                v-model.number="resizeSlider"
                type="range"
                min="10"
                max="100"
                step="1"
                class="w-full accent-[#0071e3] cursor-pointer"
              />
              <div class="flex justify-between text-[14px] text-[#86868b] mt-0.5">
                <span>10%</span><span>原始尺寸</span>
              </div>
            </div>

            <p v-if="errorMsg" class="text-[14px] text-[#ff3b30]">{{ errorMsg }}</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
