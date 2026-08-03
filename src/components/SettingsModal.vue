<script setup lang="ts">
import {
  Check,
  Close,
  Lock,
  PreviewCloseOne,
  PreviewOpen,
  Setting,
  SwitchButton,
  User,
} from '@icon-park/vue-next';
import { computed, ref, watch } from 'vue';
import type { User as UserType } from '../types/note';

const props = defineProps<{
  show: boolean;
  summaryEnabled: boolean;
  authMode: 'login' | 'register';
  authUsername: string;
  authPassword: string;
  currentUser: UserType | null;
  authLoading: boolean;
  authError: string;
}>();

const emit = defineEmits([
  'update:summaryEnabled',
  'update:authMode',
  'update:authUsername',
  'update:authPassword',
  'close',
  'saveConfig',
  'submitAuth',
  'logout',
]);

const showPassword = ref(false);

// 切换登录/注册时清空错误
watch(
  () => props.authMode,
  () => {
    // 切换模式时保留输入便于用户切换
  },
);

const isLoggedIn = computed(() => !!props.currentUser);
const usernameInitial = computed(() => {
  const u = props.currentUser?.username || '?';
  return u.charAt(0).toUpperCase();
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
      class="bg-white/95 backdrop-blur-[20px] rounded-2xl shadow-[0_8px_40px_rgba(0,0,0,0.12)] w-[400px] max-h-[85vh] overflow-hidden flex flex-col"
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

          <!-- 登录/注册 切换 -->
          <div class="flex bg-black/[0.04] rounded-xl p-0.5 mb-4">
            <button
              @click="emit('update:authMode', 'login')"
              class="flex-1 py-1.5 text-[13px] font-medium rounded-lg transition"
              :class="
                authMode === 'login'
                  ? 'bg-white text-[#0071e3] shadow-sm'
                  : 'text-[#86868b] hover:text-[#1d1d1f]'
              "
            >
              登录
            </button>
            <button
              @click="emit('update:authMode', 'register')"
              class="flex-1 py-1.5 text-[13px] font-medium rounded-lg transition"
              :class="
                authMode === 'register'
                  ? 'bg-white text-[#0071e3] shadow-sm'
                  : 'text-[#86868b] hover:text-[#1d1d1f]'
              "
            >
              注册
            </button>
          </div>

          <form
            @submit.prevent="emit('submitAuth', authMode)"
            class="space-y-3"
          >
            <div class="relative">
              <user
                theme="outline"
                size="14"
                :stroke-width="3"
                class="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b] pointer-events-none"
              />
              <input
                :value="authUsername"
                @input="
                  emit(
                    'update:authUsername',
                    ($event.target as HTMLInputElement).value,
                  )
                "
                type="text"
                placeholder="用户名（3-20 位）"
                autocomplete="username"
                class="w-full bg-black/[0.04] border-none rounded-xl pl-9 pr-3 py-2.5 text-[14px] text-[#1d1d1f] placeholder-[#86868b] outline-none focus:bg-black/[0.06] transition"
              />
            </div>
            <div class="relative">
              <lock
                theme="outline"
                size="14"
                :stroke-width="3"
                class="absolute left-3 top-1/2 -translate-y-1/2 text-[#86868b] pointer-events-none"
              />
              <input
                :value="authPassword"
                @input="
                  emit(
                    'update:authPassword',
                    ($event.target as HTMLInputElement).value,
                  )
                "
                :type="showPassword ? 'text' : 'password'"
                placeholder="密码（至少 6 位）"
                :autocomplete="
                  authMode === 'login' ? 'current-password' : 'new-password'
                "
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
            <div v-if="authError" class="text-[12px] text-[#ff3b30] pl-1">
              {{ authError }}
            </div>
            <button
              type="submit"
              :disabled="authLoading"
              class="w-full bg-[#0071e3] text-white rounded-xl py-2.5 text-[14px] font-medium hover:bg-[#0077ed] disabled:opacity-65 transition flex items-center justify-center gap-1.5"
            >
              <check
                v-if="!authLoading"
                theme="outline"
                size="14"
                :stroke-width="4"
              />
              <span>
                {{
                  authLoading
                    ? '处理中...'
                    : authMode === 'login'
                      ? '登录'
                      : '注册并登录'
                }}
              </span>
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
              <div class="text-[12px] text-[#34c759] flex items-center gap-1">
                <check theme="outline" size="10" :stroke-width="4" />
                已登录 · 云端同步中
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
