<script setup lang="ts">
import {
  Check,
  Close,
  Lock,
  Message,
  Phone,
  PreviewCloseOne,
  PreviewOpen,
  Refresh,
  Setting,
  SwitchButton,
  User,
} from '@icon-park/vue-next';
import { computed, onUnmounted, ref, watch } from 'vue';
import { ApiError, authApi } from '../lib/api';
import {
  getBusinessApiBase,
  setBusinessApiBase,
} from '../lib/storage';
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
    channel: 'account' | 'phone' | 'email';
    account: string;
    password?: string;
    validCode?: string;
    validCodeReqNo?: string;
    rememberAccount: boolean;
    businessApiBase?: string;
  }): void;
  (e: 'logout'): void;
}>();

// ========== 本地状态 ==========
const channel = ref<'account' | 'phone' | 'email'>('account');
const showPassword = ref(false);
const account = ref(props.rememberedAccount || '');
const password = ref('');
const validCode = ref(''); // 图形/短信/邮箱 验证码
const validCodeReqNo = ref(''); // 验证码请求号（来自后端返回）
const rememberMe = ref(false);
const captchaImage = ref(''); // 图形验证码 base64
const captchaOpen = ref(false); // 是否启用图形验证码
const businessApiBase = ref(getBusinessApiBase());
const authError = ref('');
const authLoading = ref(false);

// 倒计时（短信/邮箱 60s）
const sendCooldown = ref(0);
let cooldownTimer: number | null = null;
const startCooldown = (seconds: number) => {
  sendCooldown.value = seconds;
  if (cooldownTimer) clearInterval(cooldownTimer);
  cooldownTimer = window.setInterval(() => {
    sendCooldown.value -= 1;
    if (sendCooldown.value <= 0 && cooldownTimer) {
      clearInterval(cooldownTimer);
      cooldownTimer = null;
    }
  }, 1000);
};
onUnmounted(() => {
  if (cooldownTimer) clearInterval(cooldownTimer);
});

// ========== 校验正则（对接文档第七章） ==========
const PHONE_RE = /^(13[0-9]|14[579]|15[0-3,5-9]|16[6]|17[0135678]|18[0-9]|19[89])\d{8}$/;
const EMAIL_RE = /^[a-zA-Z0-9_-]+@[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)+$/;

const isAccountValid = computed(() => {
  if (channel.value === 'phone') return PHONE_RE.test(account.value);
  if (channel.value === 'email') return EMAIL_RE.test(account.value);
  // 账号登录对接文档未限制具体规则，至少 1 位即可
  return account.value.trim().length > 0;
});

const isPasswordValid = computed(() => {
  if (channel.value !== 'account') return true;
  return password.value.length >= 6;
});

const isValidCodeFilled = computed(() => {
  if (channel.value === 'account' && captchaOpen.value) return validCode.value.length > 0;
  if (channel.value === 'phone' || channel.value === 'email') return validCode.value.length >= 4;
  return true;
});

const canSubmit = computed(
  () =>
    !authLoading.value &&
    isAccountValid.value &&
    isPasswordValid.value &&
    isValidCodeFilled.value,
);

const channelLabels: Record<typeof channel.value, string> = {
  account: '账号',
  phone: '手机号',
  email: '邮箱',
};

const isLoggedIn = computed(() => !!props.currentUser);
const usernameInitial = computed(() => {
  const u = props.currentUser?.username || '?';
  return u.charAt(0).toUpperCase();
});

// ========== 切换 channel 重置状态 ==========
const resetForm = () => {
  password.value = '';
  validCode.value = '';
  validCodeReqNo.value = '';
  authError.value = '';
  captchaImage.value = '';
};

watch(channel, () => {
  resetForm();
});

// 打开时初始化业务 baseURL 显示
watch(
  () => props.show,
  (v) => {
    if (v) {
      businessApiBase.value = getBusinessApiBase();
    }
  },
);

// ========== 业务 baseURL 失焦保存 ==========
const onBusinessBaseBlur = () => {
  setBusinessApiBase(businessApiBase.value.trim());
};

// ========== 图形验证码 ==========
const loadPicCaptcha = async () => {
  try {
    const data = (await authApi.getPicCaptcha()) as {
      validCodeReqNo?: string;
      captcha?: string;
      // 也兼容直接字段
      reqNo?: string;
      img?: string;
      image?: string;
    };
    validCodeReqNo.value = data?.validCodeReqNo || data?.reqNo || '';
    captchaImage.value = data?.captcha || data?.img || data?.image || '';
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : '获取图形验证码失败';
    authError.value = msg;
  }
};

// ========== 发送验证码（短信 / 邮箱） ==========
const sendValidCode = async () => {
  if (sendCooldown.value > 0) return;
  if (!isAccountValid.value) {
    authError.value = `请输入正确的${channelLabels[channel.value]}`;
    return;
  }
  authError.value = '';
  try {
    if (channel.value === 'phone') {
      await authApi.getPhoneValidCode(account.value);
    } else if (channel.value === 'email') {
      await authApi.getEmailValidCode(account.value);
    }
    startCooldown(60);
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : '验证码发送失败';
    authError.value = msg;
  }
};

// ========== 提交登录 ==========
const onSubmit = async () => {
  if (!canSubmit.value) return;
  authError.value = '';
  authLoading.value = true;
  try {
    emit('submitAuth', {
      mode: 'login',
      channel: channel.value,
      account: account.value.trim(),
      password: password.value || undefined,
      validCode: validCode.value || undefined,
      validCodeReqNo: validCodeReqNo.value || undefined,
      rememberAccount: rememberMe.value,
      businessApiBase: businessApiBase.value.trim(),
    });
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : '登录失败';
    authError.value = msg;
  } finally {
    authLoading.value = false;
  }
};

// 接收父组件透传的登录错误
defineExpose({
  setError: (msg: string) => {
    authError.value = msg;
  },
});
</script>

<template>
  <div
    class="absolute inset-0 bg-black/30 backdrop-blur-[4px] flex items-center justify-center z-[200] transition-opacity duration-200"
    :class="
      show ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
    "
    @click="emit('close')"
  >
    <div
      class="bg-white/95 backdrop-blur-[20px] rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] w-[440px] max-h-[88vh] overflow-hidden flex flex-col"
      @click.stop
    >
      <div
        class="px-6 pt-6 pb-4 flex justify-between items-center border-b border-black/[0.06] shrink-0"
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

      <div class="px-6 py-5 space-y-5 overflow-y-auto">
        <!-- 账户区域 -->
        <div v-if="!isLoggedIn">
          <div class="flex items-center gap-2 mb-3">
            <user
              theme="outline"
              size="16"
              :stroke-width="3"
              class="text-[#0071e3]"
            />
            <span class="text-[13px] font-medium text-[#1d1d1f]">账户</span>
            <span class="text-[12px] text-[#86868b] ml-1">
              登录后可在多端同步便签
            </span>
          </div>

          <!-- 登录方式 tab：账号 / 手机号 / 邮箱 -->
          <div class="flex bg-black/[0.04] rounded-xl p-0.5 mb-4">
            <button
              v-for="opt in [
                { v: 'account', label: '账号' },
                { v: 'phone', label: '手机号' },
                { v: 'email', label: '邮箱' },
              ]"
              :key="opt.v"
              @click="channel = opt.v as any"
              class="flex-1 py-1.5 text-[13px] font-medium rounded-lg transition"
              :class="
                channel === opt.v
                  ? 'bg-white text-[#0071e3] shadow-sm'
                  : 'text-[#86868b] hover:text-[#1d1d1f]'
              "
            >
              {{ opt.label }}
            </button>
          </div>

          <form @submit.prevent="onSubmit" class="space-y-3">
            <!-- 账号 / 手机 / 邮箱 输入框 -->
            <div class="relative">
              <user
                v-if="channel === 'account'"
                theme="outline"
                size="14"
                :stroke-width="3"
                class="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b] pointer-events-none"
              />
              <phone
                v-else-if="channel === 'phone'"
                theme="outline"
                size="14"
                :stroke-width="3"
                class="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b] pointer-events-none"
              />
              <message
                v-else
                theme="outline"
                size="14"
                :stroke-width="3"
                class="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b] pointer-events-none"
              />
              <input
                v-model="account"
                type="text"
                :placeholder="
                  channel === 'phone'
                    ? '请输入手机号'
                    : channel === 'email'
                      ? '请输入邮箱'
                      : '请输入账号'
                "
                :autocomplete="channel === 'account' ? 'username' : 'off'"
                class="w-full bg-black/[0.04] border-none rounded-xl pl-9 pr-3 py-2.5 text-[14px] text-[#1d1d1f] placeholder-[#86868b] outline-none focus:bg-black/[0.06] transition"
              />
            </div>

            <!-- 密码（仅账号登录） -->
            <div v-if="channel === 'account'" class="relative">
              <lock
                theme="outline"
                size="14"
                :stroke-width="3"
                class="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b] pointer-events-none"
              />
              <input
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="密码（至少 6 位）"
                autocomplete="current-password"
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

            <!-- 验证码：账号登录 = 图形验证码；手机/邮箱 = 短信/邮箱验证码 -->
            <div v-if="channel === 'account' && captchaOpen" class="flex gap-2">
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

            <div v-if="channel === 'phone' || channel === 'email'" class="flex gap-2">
              <input
                v-model="validCode"
                type="text"
                :placeholder="channel === 'phone' ? '短信验证码' : '邮箱验证码'"
                class="flex-1 bg-black/[0.04] border-none rounded-xl px-3 py-2.5 text-[14px] text-[#1d1d1f] placeholder-[#86868b] outline-none focus:bg-black/[0.06] transition"
              />
              <button
                type="button"
                @click="sendValidCode"
                :disabled="sendCooldown > 0"
                class="shrink-0 px-3 h-[42px] rounded-xl text-[13px] font-medium transition"
                :class="
                  sendCooldown > 0
                    ? 'bg-black/[0.04] text-[#86868b] cursor-not-allowed'
                    : 'bg-[#0071e3]/10 text-[#0071e3] hover:bg-[#0071e3]/15'
                "
              >
                {{ sendCooldown > 0 ? `${sendCooldown}s` : '获取验证码' }}
              </button>
            </div>

            <!-- 记住账号 -->
            <label class="flex items-center gap-2 cursor-pointer pl-1">
              <input
                v-model="rememberMe"
                type="checkbox"
                class="w-[14px] h-[14px] accent-[#0071e3]"
              />
              <span class="text-[12px] text-[#86868b]">记住账号</span>
            </label>

            <div
              v-if="authError"
              class="text-[12px] text-[#ff3b30] pl-1"
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
              <span>{{ authLoading ? '处理中...' : '登录' }}</span>
            </button>
          </form>

          <p class="text-[12px] text-[#86868b] mt-3 text-center">
            登录后，本地便签将自动同步到云端
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
            <span class="text-[13px] font-medium text-[#1d1d1f]">当前账户</span>
            <span
              v-if="!cloudMode"
              class="text-[11px] text-[#ff9500] bg-[#ff9500]/10 px-2 py-0.5 rounded-full ml-1"
              >未配置业务接口</span
            >
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
                class="text-[12px] flex items-center gap-1"
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
          <p class="text-[12px] text-[#86868b] mt-2 text-center">
            退出后将以本地模式继续使用，数据保留在本设备
          </p>
        </div>

        <!-- 分割线 -->
        <div class="border-t border-black/[0.06]"></div>

        <!-- 业务接口地址配置 -->
        <div>
          <div class="flex items-center gap-2 mb-2">
            <span class="text-[13px] font-medium text-[#1d1d1f]">业务接口地址</span>
            <span class="text-[12px] text-[#86868b]">便签/AI/上传</span>
          </div>
          <input
            v-model="businessApiBase"
            @blur="onBusinessBaseBlur"
            type="text"
            placeholder="例如：https://your-api.example.com"
            class="w-full bg-black/[0.04] border-none rounded-xl px-3 py-2.5 text-[13px] text-[#1d1d1f] placeholder-[#86868b] outline-none focus:bg-black/[0.06] transition font-mono"
          />
          <p class="text-[11px] text-[#86868b] mt-1.5 leading-relaxed">
            留空时，登录用户也以本地模式运行；填写后便签/AI/图片上传将调用该地址的
            <code class="bg-black/[0.04] px-1 rounded">/api/notes</code> 等接口。
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
            <div class="text-[12px] text-[#86868b] mt-0.5">
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
