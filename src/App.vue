<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import ColorPopover from './components/ColorPopover.vue';
import CustomAlert from './components/CustomAlert.vue';
import EditorWorkspace from './components/EditorWorkspace.vue';
import SettingsModal from './components/SettingsModal.vue';
import Sidebar from './components/Sidebar.vue';
import Toast from './components/Toast.vue';
import { ApiError, aiApi, authApi, userNoteApi } from './lib/api';
import {
  hasLocalImages,
  migrateLocalNotesImages,
} from './lib/imageMigration';
import { sm2Encrypt } from './lib/sm2';
import {
  clearAuth,
  getRememberedAccount,
  getToken,
  getUserId,
  getUserInfo,
  LOCAL_NOTES_KEY,
  setRememberedAccount as persistRememberedAccount,
  setToken,
  setUserInfo,
} from './lib/storage';
import type { Note, User } from './types/note';

const notes = ref<Note[]>([]);
const currentNoteId = ref<number | null>(null);
const searchKeyword = ref('');
const activeColorFilter = ref<string | null>(null);

const currentTitle = ref('');
const wordCount = ref(0);
const isSettingsOpen = ref(false);
const settingsModalRef = ref<InstanceType<typeof SettingsModal> | null>(null);
const isAiLoading = ref(false);
const aiStatusText = ref('AI 标题已就绪');
const aiDotColor = ref('#86868b');
const isTitleShimmering = ref(false);
const aiTitleInProgress = ref(false);

const toast = reactive({ show: false, message: '已复制纯文本到剪贴板' });
const customAlert = reactive({ show: false, title: '', message: '' });
const colorPopover = reactive({
  show: false,
  noteId: null as number | null,
  top: 0,
  left: 0,
});

const currentUser = ref<User | null>(null);

let aiEditorInstance: any = null;
let isInternalUpdate = false;

// 已登录即视为「云端模式」（业务后端固定为本地 http://localhost:82）
const isCloudMode = computed(() => !!currentUser.value);

const getPlainSnippet = (htmlBody: string): string => {
  const tempDiv = document.createElement('div');
  tempDiv.innerHTML = htmlBody || '';
  return (tempDiv.textContent || tempDiv.innerText || '').trim();
};

const ensureNoteShape = (note: Note, index: number): Note => ({
  ...note,
  createdAt: note.createdAt ?? note.id ?? Date.now(),
  pinned: note.pinned ?? false,
  color: note.color ?? null,
  order: note.order ?? index,
});

const filteredNotes = computed(() => {
  const list = [...notes.value].map((n, i) => ensureNoteShape(n, i));
  list.sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
    return a.order - b.order;
  });

  return list.filter((note) => {
    if (activeColorFilter.value !== null) {
      if (activeColorFilter.value === 'default') {
        if (note.color) return false;
      } else if (note.color !== activeColorFilter.value) {
        return false;
      }
    }
    if (!searchKeyword.value) return true;
    const plainText = getPlainSnippet(note.body).toLowerCase();
    const titleText = (note.title || '').toLowerCase();
    const kw = searchKeyword.value.toLowerCase();
    return titleText.includes(kw) || plainText.includes(kw);
  });
});

const currentNote = computed(() =>
  notes.value.find((n) => n.id === currentNoteId.value),
);

let saveTimer: number | null = null;
const SAVE_DEBOUNCE = 600;

const saveNotes = () => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persistNotes, SAVE_DEBOUNCE);
};

// 业务接口可用性：已登录（有 token）即走云端
const canSyncBusiness = () => !!getToken();

const persistNotes = async () => {
  // 本地模式：写入 localStorage
  if (!canSyncBusiness()) {
    try {
      localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes.value));
    } catch (e) {
      console.error('保存到本地失败:', e);
    }
    return;
  }
  // 云端模式：调用便签接口（/dev/userNote/save，需 userId）
  try {
    await userNoteApi.saveNote({ notes: notes.value });
  } catch (e) {
    console.error('保存笔记失败:', e);
  }
};

const flushNotesBeacon = () => {
  if (canSyncBusiness() && notes.value.length > 0) {
    try {
      const blob = new Blob([JSON.stringify({ notes: notes.value })], {
        type: 'application/json',
      });
      // sendBeacon 走 fetch 不便携带 token 头，故不适用于新接口；
      // 关页面前最后一次保存通过 persistNotes（同步写 localStorage）。
    } catch (e) {
      // 忽略
    }
  }
  // 同步写 localStorage 兜底
  try {
    localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes.value));
  } catch (e) {
    // 忽略
  }
};

window.addEventListener('beforeunload', flushNotesBeacon);

const showToast = (msg: string) => {
  toast.message = msg || '已复制纯文本到剪贴板';
  toast.show = true;
  setTimeout(() => {
    toast.show = false;
  }, 2000);
};

const showCustomAlert = (title: string, message: string) => {
  customAlert.title = title;
  customAlert.message = message;
  customAlert.show = true;
};

const closeCustomAlert = () => {
  customAlert.show = false;
};

// 加载本地存储（未登录 / 未配置业务 baseURL 时）
const loadLocalData = () => {
  try {
    const raw = localStorage.getItem(LOCAL_NOTES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        notes.value = parsed.map((n: Note, i: number) => ensureNoteShape(n, i));
      }
    }
  } catch (e) {
    console.error('读取本地笔记失败:', e);
  }
  if (notes.value.length > 0 && currentNoteId.value === null) {
    currentNoteId.value = notes.value[0].id;
  }
};

// 启动时清理空便签
const cleanupEmptyNotes = () => {
  notes.value = notes.value.filter((n) => {
    const hasTitle = (n.title || '').trim().length > 0;
    const hasBody = getPlainSnippet(n.body || '').length > 0;
    return hasTitle || hasBody;
  });
  if (
    currentNoteId.value &&
    !notes.value.find((n) => n.id === currentNoteId.value)
  ) {
    currentNoteId.value = notes.value.length > 0 ? notes.value[0].id : null;
  }
};

// 登录成功后调用：对接文档第四章 afterLogin 流程
// 1. token 已由 setToken 写入（请求拦截器自动放入 token 请求头）
// 2. 调用 /auth/c/getLoginUser 获取用户信息（含 id），存入 CLIENT_USER_INFO
//    —— md/C端用户信息对接文档.md：data.id 即用户 ID，后续便签接口依赖此值
// 3. 加载业务数据（需 userId 就绪后才能调便签接口）
const afterLogin = async (fallbackUser: User) => {
  // 优先用 getLoginUser 拉取真实用户信息；失败则回退到登录入参构造的 user
  let user: User = fallbackUser;
  let userId: string | undefined;
  try {
    const resp = await authApi.getLoginUser();
    const obj = (resp || {}) as Record<string, unknown>;
    const inner = (obj.data || obj.result || obj) as Record<string, unknown>;
    const username =
      (typeof inner.username === 'string' && inner.username) ||
      (typeof inner.nickName === 'string' && inner.nickName) ||
          (typeof inner.nickname === 'string' && inner.nickname) ||
      (typeof inner.name === 'string' && inner.name) ||
      fallbackUser.username;
    const account =
      (typeof inner.account === 'string' && inner.account) ||
      fallbackUser.account;
    // 提取用户 ID（便签接口所需，见 md/C端用户信息对接文档.md）
    if (typeof inner.id === 'string' && inner.id) {
      userId = inner.id;
    } else if (typeof inner.id === 'number') {
      userId = String(inner.id);
    }
    // 仅账号登录
    user = { username, account, loginType: 'account' };
  } catch (e) {
    // 拉取用户信息失败不阻断登录流程，使用 fallback
    console.warn('getLoginUser 失败，使用登录入参作为用户信息', e);
  }

  currentUser.value = user;
  setUserInfo({
    username: user.username,
    account: user.account,
    loginType: user.loginType,
    userId, // 便签接口依赖此字段
  });
  await loadUserData();
};

// 加载已登录用户的云端数据
const loadUserData = async () => {
  if (!canSyncBusiness()) {
    // 业务 baseURL 未配置：退化为本地模式
    loadLocalData();
    return;
  }
  try {
    // 便签接口需先拿到 userId（登录时已存入 CLIENT_USER_INFO）
    const userId = getUserId();
    if (!userId) {
      throw new ApiError(0, '未获取到用户 ID，无法加载便签');
    }

    const noteResult = await userNoteApi.getNote<{ notes?: Note[] } | Note[] | null>(userId);

    let remoteNotes: Note[] = [];
    const noteData = noteResult.data;
    if (Array.isArray(noteData)) {
      // data 直接是便签数组
      remoteNotes = noteData;
    } else if (noteData && typeof noteData === 'object') {
      // data 是 { notes: Note[] } 结构
      const wrapped = noteData as { notes?: Note[] };
      remoteNotes = Array.isArray(wrapped.notes) ? wrapped.notes : [];
    }
    remoteNotes = remoteNotes.map((n, i) => ensureNoteShape(n, i));

    // 业务接口为空但本地有数据 → 上传本地（迁移）
    if (remoteNotes.length === 0) {
      const localRaw = localStorage.getItem(LOCAL_NOTES_KEY);
      if (localRaw) {
        try {
          const localNotes = JSON.parse(localRaw);
          if (Array.isArray(localNotes) && localNotes.length > 0) {
            const normalized = localNotes.map((n: Note, i: number) =>
              ensureNoteShape(n, i),
            );
            // 登录后迁移：把本地内嵌图片（base64）上传到服务器并替换地址
            let toSync = normalized;
            if (hasLocalImages(normalized)) {
              try {
                const migrated = await migrateLocalNotesImages(normalized);
                if (migrated.length > 0) {
                  // 用迁移后的笔记（图片已替换为网络地址）覆盖原本地笔记
                  const byId = new Map(migrated.map((n) => [n.id, n]));
                  toSync = normalized.map((n) => byId.get(n.id) || n);
                }
              } catch (e) {
                console.warn('本地图片迁移失败，仍按原内容同步:', e);
              }
            }
            await userNoteApi.saveNote({ notes: toSync }, userId);
            remoteNotes = toSync;
            localStorage.removeItem(LOCAL_NOTES_KEY);
            showToast('已同步本地便签到云端');
          }
        } catch (e) {
          // 忽略
        }
      }
    } else {
      localStorage.removeItem(LOCAL_NOTES_KEY);
    }

    notes.value = remoteNotes;
    currentNoteId.value = remoteNotes.length > 0 ? remoteNotes[0].id : null;
    if (currentNote.value) {
      currentTitle.value = currentNote.value.title || '';
    }
  } catch (e) {
    const msg =
      e instanceof ApiError ? e.message : '网络异常，无法加载云端数据';
    showCustomAlert('加载失败', msg);
  }
};

// 登录 / 注册入口
// 注册：调 /auth/c/register，成功后不自动登录，提示并切回登录页（对接文档第五章）
const handleAuthSubmit = async (params: {
  mode: 'login' | 'register';
  account: string;
  password: string;
  validCode?: string;
  validCodeReqNo?: string;
  rememberAccount: boolean;
}) => {
  try {
    // 密码前端 SM2 加密（对接文档第四章，禁止明文）
    const encPwd = sm2Encrypt(params.password);

    // ===== 注册分支：注册成功后不自动登录，切回登录页 =====
    if (params.mode === 'register') {
      await authApi.register({
        account: params.account,
        password: encPwd,
        validCode: params.validCode,
        validCodeReqNo: params.validCodeReqNo,
      });
      // 对接文档第五章：注册成功，引导用户登录
      showToast('注册成功，请登录');
      // 切回登录 tab 并回填账号
      settingsModalRef.value?.switchToLogin();
      return;
    }

    // ===== 登录分支 =====
    // 记住账号
    if (params.rememberAccount) {
      persistRememberedAccount(params.account);
    } else {
      try {
        localStorage.removeItem('REMEMBER_ACCOUNT');
      } catch {
        /* noop */
      }
    }

    const resp = await authApi.doLogin({
      account: params.account,
      password: encPwd,
      validCode: params.validCode,
      validCodeReqNo: params.validCodeReqNo,
    });

    // doRequest 已剥离统一结构，resp 即为 data
    // 登录成功 data 直接就是 token 字符串，兼容个别返回对象的场景
    let token = '';
    if (typeof resp === 'string' && resp) {
      token = resp;
    } else if (resp && typeof resp === 'object') {
      const obj = resp as Record<string, unknown>;
      const inner = (obj.data || obj) as Record<string, unknown>;
      token =
        (typeof obj.token === 'string' && obj.token) ||
        (typeof obj.accessToken === 'string' && obj.accessToken) ||
        (typeof inner.token === 'string' && inner.token) ||
        (typeof inner.accessToken === 'string' && inner.accessToken) ||
        '';
    }
    if (!token) {
      throw new ApiError(0, '登录成功但未返回 token，请联系后端确认');
    }
    setToken(token);

    // 构造本地用户
    const user: User = {
      username: params.account,
      loginType: 'account',
      account: params.account,
    };
    await afterLogin(user);

    showToast('登录成功');
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : (params.mode === 'register' ? '注册失败，请重试' : '登录失败，请重试');
    // 回传错误到 SettingsModal 展示
    settingsModalRef.value?.setError(msg);
    // 文档第一章：登录失败且验证码开启 → 主动刷新图形验证码
    settingsModalRef.value?.refreshCaptchaIfOpen();
  } finally {
    // 请求结束，解除按钮禁用
    settingsModalRef.value?.setLoading(false);
  }
};

const logout = async () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // 退出前把当前数据落盘到本地
  try {
    if (canSyncBusiness() && notes.value.length > 0) {
      await persistNotes();
    } else {
      localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes.value));
    }
  } catch (e) {
    // 忽略
  }
  // 调用 doLogout（即便失败也要清本地态）
  if (getToken()) {
    try {
      await authApi.doLogout();
    } catch (e) {
      // 忽略
    }
  }
  clearAuth();
  currentUser.value = null;
  // 重新加载本地数据
  loadLocalData();
};

const selectNote = (id: number) => {
  currentNoteId.value = id;
};

const createNewNote = () => {
  const now = Date.now();
  const minOrder =
    notes.value.length > 0 ? Math.min(...notes.value.map((n) => n.order)) : 0;
  const newNote: Note = {
    id: now,
    title: '',
    body: '',
    updatedAt: now,
    createdAt: now,
    pinned: false,
    color: null,
    order: minOrder - 1,
  };
  notes.value.unshift(newNote);
  currentNoteId.value = newNote.id;
  saveNotes();
  nextTick(() => {
    const titleEl = document.querySelector(
      'input[placeholder="无标题"]',
    ) as HTMLInputElement;
    if (titleEl) titleEl.focus();
  });
};

const onTitleInput = () => {
  if (!currentNote.value) return;
  currentNote.value.title = currentTitle.value;
  currentNote.value.updatedAt = Date.now();
  saveNotes();
};

const deleteNoteById = (id: number) => {
  notes.value = notes.value.filter((n) => n.id !== id);
  if (currentNoteId.value === id) {
    currentNoteId.value = notes.value.length > 0 ? notes.value[0].id : null;
  }
  saveNotes();
};

const deleteCurrentNote = () => {
  if (!currentNoteId.value) return;
  deleteNoteById(currentNoteId.value);
};

const copyCurrentNote = () => {
  if (!currentNote.value) return;
  const pureText = getPlainSnippet(currentNote.value.body);
  const contentToCopy = `${currentNote.value.title}\n\n${pureText}`;
  navigator.clipboard.writeText(contentToCopy).then(() => {
    showToast('已复制纯文本到剪贴板');
  });
};

const togglePin = (id: number) => {
  const note = notes.value.find((n) => n.id === id);
  if (note) {
    note.pinned = !note.pinned;
    saveNotes();
  }
};

const toggleColorPopover = (event: MouseEvent, id: number) => {
  event.stopPropagation();
  if (colorPopover.show && colorPopover.noteId === id) {
    colorPopover.show = false;
    return;
  }
  const btn = event.currentTarget as HTMLElement;
  const rect = btn.getBoundingClientRect();
  const popoverWidth = 224;
  colorPopover.noteId = id;
  colorPopover.top = rect.bottom + 6;
  colorPopover.left = Math.max(
    8,
    Math.min(rect.left, window.innerWidth - popoverWidth - 8),
  );
  colorPopover.show = true;
};

const closeColorPopover = () => {
  colorPopover.show = false;
};

const setNoteColor = (id: number, color: string | null) => {
  const note = notes.value.find((n) => n.id === id);
  if (note) {
    note.color = color;
    note.updatedAt = Date.now();
    saveNotes();
  }
  colorPopover.show = false;
};

// 手动触发：点击「AI 标题」按钮调用
const triggerAiTitle = async (noteId: number, textContent: string) => {
  if (!textContent.trim()) return;
  if (aiTitleInProgress.value) return;

  aiTitleInProgress.value = true;
  isAiLoading.value = true;
  aiStatusText.value = 'AI 正在生成标题...';
  aiDotColor.value = '#0071e3';
  isTitleShimmering.value = true;

  try {
    const systemPrompt =
      '你是一个笔记标题生成助手。请根据用户提供的笔记内容，生成一个简洁、准确的标题。' +
      '要求：1. 不超过 20 个字；2. 不要使用引号、书名号等标点；3. 只输出标题本身，不要任何解释或前缀。';
    const ollamaResp = await aiApi.chat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: textContent },
      ],
      options: { temperature: 0.3, num_predict: 64 },
    });
    const title = (ollamaResp.message?.content || '').trim();

    if (title) {
      const targetNote = notes.value.find((n) => n.id === noteId);
      if (targetNote && currentNoteId.value === noteId) {
        targetNote.title = title;
        targetNote.updatedAt = Date.now();
        saveNotes();
        if (
          document.activeElement !==
          document.querySelector('input[placeholder="无标题"]')
        ) {
          currentTitle.value = targetNote.title;
        }
      }
      aiStatusText.value = 'AI 标题更新成功';
      aiDotColor.value = '#34c759';
      setTimeout(() => {
        if (aiStatusText.value === 'AI 标题更新成功') {
          aiStatusText.value = 'AI 标题已就绪';
          aiDotColor.value = '#86868b';
        }
      }, 3000);
    } else {
      aiStatusText.value = 'AI 未返回有效标题';
      aiDotColor.value = '#ff3b30';
    }
  } catch (error) {
    const msg = error instanceof ApiError ? error.message : '网络或服务异常';
    aiStatusText.value = 'AI 服务开小差了';
    aiDotColor.value = '#ff3b30';
    showCustomAlert('AI 标题生成失败', msg);
  } finally {
    aiTitleInProgress.value = false;
    isAiLoading.value = false;
    isTitleShimmering.value = false;
  }
};

const handleManualAiTitle = () => {
  if (!currentNote.value) return;
  if (aiTitleInProgress.value) {
    showToast('AI 标题生成中，请稍候');
    return;
  }
  const plainText = getPlainSnippet(currentNote.value.body);
  if (!plainText) {
    showCustomAlert('无法生成标题', '便签内容为空，请先输入内容后再使用 AI 标题');
    return;
  }
  if (plainText.length < 10) {
    showCustomAlert(
      '内容太短',
      '当前仅 ' +
        plainText.length +
        ' 个字，至少需要 10 个字才能生成有意义的标题',
    );
    return;
  }
  triggerAiTitle(currentNote.value.id, plainText);
};

// 拖拽排序逻辑
let dragSourceId: number | null = null;
let dropIndicatorEl: HTMLElement | null = null;

const onDragStart = (event: DragEvent, note: Note) => {
  dragSourceId = note.id;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(dragSourceId));
  }
  (event.currentTarget as HTMLElement).classList.add('note-item-dragging');
};

const onDragEnd = (event: DragEvent) => {
  (event.currentTarget as HTMLElement).classList.remove('note-item-dragging');
  dragSourceId = null;
  if (dropIndicatorEl && dropIndicatorEl.parentNode) {
    dropIndicatorEl.parentNode.removeChild(dropIndicatorEl);
  }
  dropIndicatorEl = null;
};

const onDragOver = (event: DragEvent, note: Note) => {
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  if (note.id === dragSourceId) return;

  const targetEl = event.currentTarget as HTMLElement;
  const rect = targetEl.getBoundingClientRect();
  const isBefore = event.clientY < rect.top + rect.height / 2;

  if (dropIndicatorEl && dropIndicatorEl.parentNode) {
    dropIndicatorEl.parentNode.removeChild(dropIndicatorEl);
  }
  dropIndicatorEl = document.createElement('div');
  dropIndicatorEl.className = 'note-drop-indicator';

  if (isBefore) {
    targetEl.parentNode?.insertBefore(dropIndicatorEl, targetEl);
  } else {
    targetEl.parentNode?.insertBefore(dropIndicatorEl, targetEl.nextSibling);
  }
};

const onDrop = (event: DragEvent, targetNote: Note) => {
  event.preventDefault();
  if (dropIndicatorEl && dropIndicatorEl.parentNode) {
    dropIndicatorEl.parentNode.removeChild(dropIndicatorEl);
  }
  dropIndicatorEl = null;

  if (!dragSourceId || targetNote.id === dragSourceId) return;

  const sourceNote = notes.value.find((n) => n.id === dragSourceId);
  if (!sourceNote || sourceNote.pinned !== targetNote.pinned) return;

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const isBefore = event.clientY < rect.top + rect.height / 2;

  notes.value.sort((a, b) => {
    if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
    return a.order - b.order;
  });

  const sourceIdx = notes.value.findIndex((n) => n.id === sourceNote.id);
  notes.value.splice(sourceIdx, 1);

  let targetIdx = notes.value.findIndex((n) => n.id === targetNote.id);
  if (!isBefore) targetIdx += 1;

  notes.value.splice(targetIdx, 0, sourceNote);
  notes.value.forEach((n, i) => {
    n.order = i;
  });

  saveNotes();
};

// 重启恢复登录态：读 token + 用户信息，已登录即加载云端数据
const tryRestoreSession = async () => {
  const token = getToken();
  if (!token) return;
  const userInfo = getUserInfo();
  if (!userInfo || !userInfo.account) return;
  currentUser.value = {
    username: (userInfo.username as string) || (userInfo.account as string),
    loginType: 'account',
    account: userInfo.account as string,
  };
  // userId 已在 afterLogin 时存入 CLIENT_USER_INFO，loadUserData 会读取
  await loadUserData();
};

onMounted(async () => {
  // 先加载本地数据，确保用户进入主界面就有内容
  loadLocalData();
  cleanupEmptyNotes();
  // 然后异步恢复登录态（不阻塞主界面）
  try {
    await tryRestoreSession();
  } catch (e) {
    // 静默失败
  }
});

let syncInterval: number | null = null;
let lastSyncedContent = '';

const handleAiEditorReady = (editor: any) => {
  aiEditorInstance = editor;

  // 注意：AiEditor 实例没有 .on() 方法，事件需通过初始化配置的
  // onChange/onFocus/onBlur 回调注册。这里改为在下面的轮询中用
  // editor.isFocused() 做边沿检测来记录焦点时间。

  // 使用定时器同步内容变化（AIEditor 没有类似 Quill 的事件）
  if (syncInterval) clearInterval(syncInterval);
  syncInterval = window.setInterval(() => {
    if (!aiEditorInstance || !currentNoteId.value) return;

    const currentContent = editor.getHtml();

    // 同步内容变化
    if (!isInternalUpdate && currentContent !== lastSyncedContent) {
      lastSyncedContent = currentContent;
      const note = notes.value.find((n) => n.id === currentNoteId.value);
      if (note) {
        note.body = currentContent;
        note.updatedAt = Date.now();
        saveNotes();
        wordCount.value = editor.getText().trim().length;
      }
    }
  }, 500);

  if (currentNote.value) {
    currentTitle.value = currentNote.value.title;
    isInternalUpdate = true;
    lastSyncedContent = currentNote.value.body || '';
    editor.setContent(lastSyncedContent);
    isInternalUpdate = false;
    wordCount.value = editor.getText().trim().length;
  }
};

watch(currentNoteId, (newId) => {
  const note = notes.value.find((n) => n.id === newId);
  if (note && aiEditorInstance) {
    currentTitle.value = note.title;
    isInternalUpdate = true;
    lastSyncedContent = note.body || '';
    aiEditorInstance.setContent(lastSyncedContent);
    isInternalUpdate = false;
    wordCount.value = aiEditorInstance.getText().trim().length;
  }
});
</script>

<template>
  <div
    class="w-screen h-screen bg-[rgba(255,255,255,0.85)] backdrop-blur-[40px] flex overflow-hidden relative"
    @click="closeColorPopover"
  >
    <!-- 始终进入主界面（未登录也可用，数据存储在 localStorage） -->
    <Sidebar
      :currentUser="currentUser"
      :cloudMode="isCloudMode"
      v-model:searchKeyword="searchKeyword"
      v-model:activeColorFilter="activeColorFilter"
      :filteredNotes="filteredNotes"
      :currentNoteId="currentNoteId"
      @logout="logout"
      @createNote="createNewNote"
      @selectNote="selectNote"
      @togglePin="togglePin"
      @toggleColorPopover="toggleColorPopover"
      @deleteNote="deleteNoteById"
      @dragStart="onDragStart"
      @dragEnd="onDragEnd"
      @dragOver="onDragOver"
      @drop="onDrop"
      @openSettings="isSettingsOpen = true"
    />

    <EditorWorkspace
      :currentNote="currentNote"
      v-model:currentTitle="currentTitle"
      :wordCount="wordCount"
      :isAiLoading="isAiLoading"
      :aiStatusText="aiStatusText"
      :aiDotColor="aiDotColor"
      :isTitleShimmering="isTitleShimmering"
      :aiSummaryInProgress="aiTitleInProgress"
      :currentUser="currentUser"
      :cloudMode="isCloudMode"
      @titleInput="onTitleInput"
      @manualAiSummary="handleManualAiTitle"
      @copyNote="copyCurrentNote"
      @deleteNote="deleteCurrentNote"
      @aiEditorReady="handleAiEditorReady"
    />

    <ColorPopover
      :show="colorPopover.show"
      :top="colorPopover.top"
      :left="colorPopover.left"
      :noteId="colorPopover.noteId"
      :notes="notes"
      @setColor="setNoteColor"
    />

    <Toast :show="toast.show" :message="toast.message" />

    <CustomAlert
      :show="customAlert.show"
      :title="customAlert.title"
      :message="customAlert.message"
      @close="closeCustomAlert"
    />

    <SettingsModal
      ref="settingsModalRef"
      :show="isSettingsOpen"
      :currentUser="currentUser"
      :cloudMode="isCloudMode"
      :rememberedAccount="getRememberedAccount()"
      @close="isSettingsOpen = false"
      @submitAuth="handleAuthSubmit"
      @logout="logout"
    />
  </div>
</template>
