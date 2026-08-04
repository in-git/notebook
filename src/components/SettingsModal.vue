<script setup lang="ts">
import {
  Check,
  Close,
  Lock,
  PreviewCloseOne,
  PreviewOpen,
  Refresh,
  Setting,
  SwitchButton,
  User,
} from '@icon-park/vue-next';
import { computed, onUnmounted, ref, watch } from 'vue';
import { ApiError, authApi } from '../lib/api';
import type { User as UserType } from '../types/note';

const props = defineProps<{
  show: boolean;
  summaryEnabled: boolean;
  currentUser: UserType | null;
  cloudMode: boolean;
  rememberedAccount: string | null;
}>();

const emit = defineEmits<{
  (e: 'update:summaryEnabled', value: boolean): void;
  (e: 'close'): void;
  (e: 'saveConfig'): void;
  (e: 'submitAuth', params: {
    mode: 'login' | 'register';
    account: string;
    password: string;
    validCode?: string;
    validCodeReqNo?: string;
    rememberAccount: boolean;
  }): void;
  (e: 'logout'): void;
}>();

// ========== 本地状态 ==========
const mode = ref<'login' | 'register'>('login');
const showPassword = ref(false);
const showConfirmPassword = ref(false);
const account = ref(props.rememberedAccount || '');
const password = ref('');
const confirmPassword = ref('');
const validCode = ref(''); // 图形验证码
const validCodeReqNo = ref(''); // 验证码请求号（来自后端返回）
const rememberMe = ref(false);
const captchaImage = ref(''); // 图形验证码 base64
// 验证码始终启用（后端登录/注册均要求）
const captchaOpen = ref(true);
const authError = ref('');
const authLoading = ref(false);

// ========== 校验（对接文档第八章） ==========
// 账号：3-20 位，不含中文
const ACCOUNT_RE = /^[^\u4e00-\u9fa5]{3,20}$/;
// 密码：6-20 位（前端只做长度初判，复杂度最终以服务端为准）
const isAccountValid = computed(() => ACCOUNT_RE.test(account.value.trim()));
const isPasswordValid = computed(() => {
  const len = password.value.length;
  return len >= 6 && len <= 20;
});
const isConfirmValid = computed(() =>
  mode.value === 'register'
    ? confirmPassword.value === password.value && confirmPassword.value.length >= 6
    : true,
);
const isValidCodeFilled = computed(() =>
  captchaOpen.value ? validCode.value.length > 0 : true,
);

const canSubmit = computed(
  () =>
    !authLoading.value &&
    isAccountValid.value &&
    isPasswordValid.value &&
    isConfirmValid.value &&
    isValidCodeFilled.value,
);

const isLoggedIn = computed(() => !!props.currentUser);
const usernameInitial = computed(() => {
  const u = props.currentUser?.username || '?';
  return u.charAt(0).toUpperCase();
});

// ========== 切换模式重置状态 ==========
const resetForm = () => {
  password.value = '';
  confirmPassword.value = '';
  validCode.value = '';
  validCodeReqNo.value = '';
  authError.value = '';
  captchaImage.value = '';
};

watch(mode, () => {
  resetForm();
  // 注册模式也需图形验证码（若开关开启）
  if (captchaOpen.value && !captchaImage.value) {
    loadPicCaptcha();
  }
});

// 打开时加载图形验证码
watch(
  () => props.show,
  (v) => {
    if (v && !captchaImage.value) {
      loadPicCaptcha();
    }
  },
);

// ========== 图形验证码 ==========
const loadPicCaptcha = async () => {
  try {
    // 对接文档第四章：返回 { validCodeBase64, validCodeReqNo }
    const data = (await authApi.getPicCaptcha()) as {
      validCodeBase64?: string;
      validCodeReqNo?: string;
      // 兼容历史字段
      captcha?: string;
      img?: string;
      image?: string;
      reqNo?: string;
    };
    validCodeReqNo.value = data?.validCodeReqNo || data?.reqNo || '';
    captchaImage.value =
      data?.validCodeBase64 || data?.captcha || data?.img || data?.image || '';
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : '获取图形验证码失败';
    authError.value = msg;
  }
};

// ========== 提交登录 / 注册 ==========
const onSubmit = () => {
  if (!canSubmit.value) return;
  if (mode.value === 'register' && confirmPassword.value !== password.value) {
    authError.value = '两次输入的密码不一致';
    return;
  }
  authError.value = '';
  // 提交期间禁用按钮，由父组件请求结束后调 setLoading(false) 复位
  authLoading.value = true;
  emit('submitAuth', {
    mode: mode.value,
    account: account.value.trim(),
    password: password.value,
    validCode: validCode.value || undefined,
    validCodeReqNo: validCodeReqNo.value || undefined,
    rememberAccount: rememberMe.value,
  });
};

// 切换到注册
const switchToRegister = () => {
  mode.value = 'register';
};
// 切换到登录（保留账号回填，清空密码/验证码）
const switchToLogin = () => {
  mode.value = 'login';
  password.value = '';
  confirmPassword.value = '';
  validCode.value = '';
  validCodeReqNo.value = '';
  authError.value = '';
};

// 接收父组件透传的登录错误
// 文档第一章：登录失败且验证码开启 → 主动刷新图形验证码
defineExpose({
  setError: (msg: string) => {
    authError.value = msg;
  },
  setLoading: (v: boolean) => {
    authLoading.value = v;
  },
  switchToLogin,
  refreshCaptchaIfOpen: () => {
    validCode.value = '';
    loadPicCaptcha();
  },
});

onUnmounted(() => {
  /* noop */
});
</script>

<template>
  <div
    class="absolute inset-0 bg-black/30 backdrop-blur-[4px] flex items-center justify-center z-[200] transition-opacity duration-200"
    :class="
      show ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
    "
  >
    <div
      class="bg-white/95 backdrop-blur-[20px] rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] w-[440px] max-h-[88vh] overflow-hidden flex flex-col"
      @click.stop
    >
      <div
        class="px-6 flex justify-between items-center border-b border-black/[0.06] shrink-0"
      >
        <h3
          class="text-lg font-semibold text-[#1d1d1f] flex items-center gap-2"
        >
          <setting
            theme="outline"
            size="20"
            :stroke-width="3"
            class="text-[#0071e3]"
          />
          设置
        </h3>
        <button
          @click="emit('close')"
          class="bg-transparent border-none cursor-pointer w-7 h-7 rounded-full flex items-center justify-center text-[#86868b] hover:bg-black/5 transition"
        >
          <close theme="outline" size="16" :stroke-width="3" />
        </button>
      </div>

      <div class="px-6 pb-5 space-y-5 overflow-y-auto">
        <!-- 账户区域 -->
        <div v-if="!isLoggedIn">
          <div class="flex items-center gap-2 mb-3">
            <user
              theme="outline"
              size="16"
              :stroke-width="3"
              class="text-[#0071e3]"
            />
            <span class="text-[14px] font-medium text-[#1d1d1f]">账户</span>
            <span class="text-[14px] text-[#86868b] ml-1">
              登录后可在多端同步便签
            </span>
          </div>

          <!-- 登录 / 注册 tab -->
          <div class="flex bg-black/[0.04] rounded-xl p-0.5 mb-4">
            <button
              @click="switchToLogin"
              class="flex-1 py-1.5 text-[14px] font-medium rounded-lg transition"
              :class="
                mode === 'login'
                  ? 'bg-white text-[#0071e3] shadow-sm'
                  : 'text-[#86868b] hover:text-[#1d1d1f]'
              "
            >
              登录
            </button>
            <button
              @click="switchToRegister"
              class="flex-1 py-1.5 text-[14px] font-medium rounded-lg transition"
              :class="
                mode === 'register'
                  ? 'bg-white text-[#0071e3] shadow-sm'
                  : 'text-[#86868b] hover:text-[#1d1d1f]'
              "
            >
              注册
            </button>
          </div>

          <form @submit.prevent="onSubmit" class="space-y-3">
            <!-- 账号输入框 -->
            <div class="relative">
              <user
                theme="outline"
                size="14"
                :stroke-width="3"
                class="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b] pointer-events-none"
              />
              <input
                v-model="account"
                type="text"
                placeholder="账号（3-20 位，不含中文）"
                autocomplete="username"
                class="w-full bg-black/[0.04] border-none rounded-xl pl-9 pr-3 py-2.5 text-[14px] text-[#1d1d1f] placeholder-[#86868b] outline-none focus:bg-black/[0.06] transition"
              />
            </div>

            <!-- 密码 -->
            <div class="relative">
              <lock
                theme="outline"
                size="14"
                :stroke-width="3"
                class="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b] pointer-events-none"
              />
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="密码（6-20 位）"
                :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
                class="w-full bg-black/[0.04] border-none rounded-xl pl-9 pr-10 py-2.5 text-[14px] text-[#1d1d1f] placeholder-[#86868b] outline-none focus:bg-black/[0.06] transition"
              />
              <button
                type="button"
                @click="showPassword = !showPassword"
                class="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-[#86868b] hover:bg-black/5 transition"
              >
                <preview-open
                  v-if="!showPassword"
                  theme="outline"
                  size="14"
                  :stroke-width="3"
                />
                <preview-close-one
                  v-else
                  theme="outline"
                  size="14"
                  :stroke-width="3"
                />
              </button>
            </div>

            <!-- 确认密码（仅注册） -->
            <div v-if="mode === 'register'" class="relative">
              <lock
                theme="outline"
                size="14"
                :stroke-width="3"
                class="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b] pointer-events-none"
              />
              <input
                v-model="confirmPassword"
                :type="showConfirmPassword ? 'text' : 'password'"
                placeholder="确认密码"
                autocomplete="new-password"
                class="w-full bg-black/[0.04] border-none rounded-xl pl-9 pr-10 py-2.5 text-[14px] text-[#1d1d1f] placeholder-[#86868b] outline-none focus:bg-black/[0.06] transition"
              />
              <button
                type="button"
                @click="showConfirmPassword = !showConfirmPassword"
                class="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-[#86868b] hover:bg-black/5 transition"
              >
                <preview-open
                  v-if="!showConfirmPassword"
                  theme="outline"
                  size="14"
                  :stroke-width="3"
                />
                <preview-close-one
                  v-else
                  theme="outline"
                  size="14"
                  :stroke-width="3"
                />
              </button>
            </div>

            <!-- 图形验证码 -->
            <div v-if="captchaOpen" class="flex gap-2">
              <input
                v-model="validCode"
                type="text"
                placeholder="图形验证码"
                class="flex-1 bg-black/[0.04] border-none rounded-xl px-3 py-2.5 text-[14px] text-[#1d1d1f] placeholder-[#86868b] outline-none focus:bg-black/[0.06] transition"
              />
              <div
                class="w-[100px] h-[42px] rounded-xl bg-black/[0.04] flex items-center justify-center overflow-hidden cursor-pointer"
                @click="loadPicCaptcha"
                :title="captchaImage ? '点击换一张' : '点击获取验证码'"
              >
                <img
                  v-if="captchaImage"
                  :src="captchaImage"
                  alt="验证码"
                  class="w-full h-full object-contain"
                />
                <refresh
                  v-else
                  theme="outline"
                  size="16"
                  :stroke-width="3"
                  class="text-[#86868b]"
                />
              </div>
            </div>

            <!-- 记住账号（仅登录） -->
            <label v-if="mode === 'login'" class="flex items-center gap-2 cursor-pointer pl-1">
              <input
                v-model="rememberMe"
                type="checkbox"
                class="w-[14px] h-[14px] accent-[#0071e3]"
              />
              <span class="text-[14px] text-[#86868b]">记住账号</span>
            </label>

            <div
              v-if="authError"
              class="text-[14px] text-[#ff3b30] pl-1"
            >
              {{ authError }}
            </div>

            <button
              type="submit"
              :disabled="!canSubmit"
              class="w-full bg-[#0071e3] text-white rounded-xl py-2.5 text-[14px] font-medium hover:bg-[#0077ed] disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5"
            >
              <check
                v-if="!authLoading"
                theme="outline"
                size="14"
                :stroke-width="4"
              />
              <span>{{
                authLoading
                  ? '处理中...'
                  : mode === 'register'
                    ? '注册'
                    : '登录'
              }}</span>
            </button>
          </form>

          <p class="text-[14px] text-[#86868b] mt-3 text-center">
            {{
              mode === 'register'
                ? '注册成功后请返回登录'
                : '登录后，本地便签将自动同步到云端'
            }}
          </p>
        </div>

        <!-- 已登录：账户信息 + 退出 -->
        <div v-else>
          <div class="flex items-center gap-2 mb-3">
            <user
              theme="outline"
              size="16"
              :stroke-width="3"
              class="text-[#0071e3]"
            />
            <span class="text-[14px] font-medium text-[#1d1d1f]">当前账户</span>
          </div>
          <div
            class="flex items-center gap-3 p-3 bg-black/[0.03] rounded-xl mb-3"
          >
            <div
              class="w-10 h-10 rounded-full bg-[#0071e3]/10 text-[#0071e3] flex items-center justify-center text-[15px] font-semibold shrink-0"
            >
              {{ usernameInitial }}
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-[14px] font-medium text-[#1d1d1f] truncate">
                {{ currentUser?.username }}
              </div>
              <div
                class="text-[14px] flex items-center gap-1"
                :class="cloudMode ? 'text-[#34c759]' : 'text-[#86868b]'"
              >
                <check v-if="cloudMode" theme="outline" size="10" :stroke-width="4" />
                <span>{{
                  cloudMode ? '已登录 · 云端同步中' : '已登录 · 本地模式'
                }}</span>
              </div>
            </div>
          </div>
          <button
            @click="emit('logout')"
            class="w-full bg-[#ff3b30]/10 text-[#ff3b30] rounded-xl py-2.5 text-[14px] font-medium hover:bg-[#ff3b30]/15 transition flex items-center justify-center gap-1.5"
          >
            <switch-button theme="outline" size="14" :stroke-width="3" />
            退出登录
          </button>
          <p class="text-[14px] text-[#86868b] mt-2 text-center">
            退出后将以本地模式继续使用，数据保留在本设备
          </p>
        </div>

        <!-- 分割线 -->
        <div class="border-t border-black/[0.06]"></div>

        <!-- AI 总结开关 -->
        <div class="flex justify-between items-center">
          <div class="flex-1 pr-4">
            <div
              class="text-[15px] font-medium text-[#1d1d1f] flex items-center gap-1.5"
            >
              AI 自动总结标题
            </div>
            <div class="text-[14px] text-[#86868b] mt-0.5">
              失焦后自动调用 AI 为便签生成标题
            </div>
          </div>
          <label
            class="relative inline-block w-[51px] h-[31px] cursor-pointer shrink-0"
          >
            <input
              type="checkbox"
              :checked="summaryEnabled"
              @change="
                emit(
                  'update:summaryEnabled',
                  ($event.target as HTMLInputElement).checked,
                );
                emit('saveConfig');
              "
              class="sr-only peer"
            />
            <span
              class="absolute inset-0 bg-[#e9e9ea] rounded-full transition-colors peer-checked:bg-[#34c759]"
            ></span>
            <span
              class="absolute top-[2px] left-[2px] w-[27px] h-[27px] bg-white rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-transform peer-checked:translate-x-[20px]"
            ></span>
          </label>
        </div>
      </div>
    </div>
  </div>
</template>
