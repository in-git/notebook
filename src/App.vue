<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import ColorPopover from './components/ColorPopover.vue';
import CustomAlert from './components/CustomAlert.vue';
import EditorWorkspace from './components/EditorWorkspace.vue';
import SettingsModal from './components/SettingsModal.vue';
import Sidebar from './components/Sidebar.vue';
import Toast from './components/Toast.vue';
import type { AiConfig, Note, User } from './types/note';

const LOCAL_NOTES_KEY = 'apple_notes_data_ai';
const LOCAL_AI_CONFIG_KEY = 'ai_config';

const notes = ref<Note[]>([]);
const currentNoteId = ref<number | null>(null);
const searchKeyword = ref('');
const activeColorFilter = ref<string | null>(null);

const currentTitle = ref('');
const wordCount = ref(0);
const isSettingsOpen = ref(false);
const isAiLoading = ref(false);
const aiStatusText = ref('AI 总结已关闭');
const aiDotColor = ref('#86868b');
const isTitleShimmering = ref(false);
const aiSummaryInProgress = ref(false);

const aiConfig = reactive<AiConfig>({ summaryEnabled: false });
const toast = reactive({ show: false, message: '已复制纯文本到剪贴板' });
const customAlert = reactive({ show: false, title: '', message: '' });
const colorPopover = reactive({
  show: false,
  noteId: null as number | null,
  top: 0,
  left: 0,
});

const currentUser = ref<User | null>(null);
const authForm = reactive({ username: '', password: '' });
const authLoading = ref(false);
const authError = ref('');
const authMode = ref<'login' | 'register'>('login');

let quillInstance: any = null;
let isInternalUpdate = false;
const aiThrottleMap: Record<number, number> = {};
const lastSubmittedContent: Record<number, string> = {};
const manuallyTitledNotes: Record<number, boolean> = {};

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

const persistNotes = async () => {
  // 未登录：写入 localStorage
  if (!currentUser.value) {
    try {
      localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes.value));
    } catch (e) {
      console.error('保存到本地失败:', e);
    }
    return;
  }
  // 已登录：写入服务器
  try {
    await fetch('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notes.value }),
    });
  } catch (e) {
    console.error('保存笔记失败:', e);
  }
};

window.addEventListener('beforeunload', () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (currentUser.value) {
    if (notes.value.length === 0) return;
    const blob = new Blob([JSON.stringify({ notes: notes.value })], {
      type: 'application/json',
    });
    navigator.sendBeacon('/api/notes', blob);
  } else {
    // 未登录：同步写入 localStorage，避免关闭页面丢失
    try {
      localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes.value));
    } catch (e) {
      // 忽略
    }
  }
});

const saveAiConfig = () => {
  updateAIStatusDisplay();
  if (!currentUser.value) {
    try {
      localStorage.setItem(LOCAL_AI_CONFIG_KEY, JSON.stringify(aiConfig));
    } catch (e) {
      // 忽略
    }
    return;
  }
  fetch('/api/ai-config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(aiConfig),
  }).catch((e) => console.error('AI 配置保存失败:', e));
};

const updateAIStatusDisplay = () => {
  if (aiConfig.summaryEnabled) {
    aiStatusText.value = 'AI 就绪';
    aiDotColor.value = '#34c759';
  } else {
    aiStatusText.value = 'AI 总结已关闭';
    aiDotColor.value = '#86868b';
  }
};

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

// 加载本地存储（未登录状态）
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
  try {
    const rawCfg = localStorage.getItem(LOCAL_AI_CONFIG_KEY);
    if (rawCfg) {
      const parsed = JSON.parse(rawCfg);
      if (parsed && typeof parsed.summaryEnabled === 'boolean') {
        Object.assign(aiConfig, parsed);
      }
    }
  } catch (e) {
    // 忽略
  }
  updateAIStatusDisplay();
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

// 加载已登录用户的数据
const loadUserData = async () => {
  try {
    const [notesResp, cfgResp] = await Promise.all([
      fetch('/api/notes'),
      fetch('/api/ai-config'),
    ]);
    const notesData = await notesResp.json();
    const cfgData = await cfgResp.json();

    let remoteNotes: Note[] = Array.isArray(notesData.notes)
      ? notesData.notes
      : [];
    remoteNotes = remoteNotes.map((n, i) => ensureNoteShape(n, i));

    // 如果服务器为空但本地有数据，上传本地数据
    if (remoteNotes.length === 0) {
      const localRaw = localStorage.getItem(LOCAL_NOTES_KEY);
      if (localRaw) {
        try {
          const localNotes = JSON.parse(localRaw);
          if (Array.isArray(localNotes) && localNotes.length > 0) {
            const normalized = localNotes.map((n: Note, i: number) =>
              ensureNoteShape(n, i),
            );
            await fetch('/api/notes', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ notes: normalized }),
            });
            remoteNotes = normalized;
            localStorage.removeItem(LOCAL_NOTES_KEY);
            showToast('已同步本地便签到云端');
          }
        } catch (e) {
          // 忽略
        }
      }
      // 同步 AI 配置
      const localCfg = localStorage.getItem(LOCAL_AI_CONFIG_KEY);
      if (localCfg) {
        try {
          const parsed = JSON.parse(localCfg);
          if (parsed && typeof parsed.summaryEnabled === 'boolean') {
            await fetch('/api/ai-config', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(parsed),
            });
            Object.assign(aiConfig, parsed);
            localStorage.removeItem(LOCAL_AI_CONFIG_KEY);
          }
        } catch (e) {
          // 忽略
        }
      }
    } else {
      // 服务器有数据，使用服务器数据，并清理本地
      Object.assign(
        aiConfig,
        cfgData && cfgData.summaryEnabled !== undefined
          ? cfgData
          : { summaryEnabled: false },
      );
      localStorage.removeItem(LOCAL_NOTES_KEY);
      localStorage.removeItem(LOCAL_AI_CONFIG_KEY);
    }

    notes.value = remoteNotes;
    currentNoteId.value = remoteNotes.length > 0 ? remoteNotes[0].id : null;
    if (currentNote.value) {
      currentTitle.value = currentNote.value.title || '';
    }
    updateAIStatusDisplay();
  } catch (e) {
    showCustomAlert('加载失败', '无法从服务器加载笔记，请刷新重试');
  }
};

const handleAuthSubmit = async (mode: 'login' | 'register') => {
  authError.value = '';
  if (!authForm.username.trim() || !authForm.password) {
    authError.value = '请输入用户名和密码';
    return;
  }
  authLoading.value = true;
  try {
    const endpoint =
      mode === 'login' ? '/api/auth/login' : '/api/auth/register';
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: authForm.username.trim(),
        password: authForm.password,
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      authError.value = data.error || '操作失败';
      return;
    }
    currentUser.value = { username: data.username };
    authForm.username = '';
    authForm.password = '';
    authError.value = '';
    await loadUserData();
  } catch (e) {
    authError.value = '网络异常，请重试';
  } finally {
    authLoading.value = false;
  }
};

const logout = async () => {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  // 退出前把当前数据落盘到本地
  try {
    if (currentUser.value && notes.value.length > 0) {
      await persistNotes();
    } else {
      localStorage.setItem(LOCAL_NOTES_KEY, JSON.stringify(notes.value));
    }
  } catch (e) {
    // 忽略
  }
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    // 忽略
  }
  currentUser.value = null;
  // 重新加载本地数据
  loadLocalData();
  authMode.value = 'login';
};

const selectNote = (id: number) => {
  if (currentNoteId.value && currentNoteId.value !== id) {
    const prevNote = notes.value.find((n) => n.id === currentNoteId.value);
    if (prevNote) {
      triggerAISummary(currentNoteId.value, getPlainSnippet(prevNote.body));
    }
  }
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
  manuallyTitledNotes[currentNote.value.id] = true;
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

const triggerAISummary = async (
  noteId: number,
  textContent: string,
  force = false,
) => {
  if (!textContent.trim()) return;
  // 未登录时不允许调用 AI（接口需要鉴权）
  if (!currentUser.value) return;
  if (aiSummaryInProgress.value) return;
  if (!force && !aiConfig.summaryEnabled) return;
  if (!force && manuallyTitledNotes[noteId]) return;
  if (!force && lastSubmittedContent[noteId] === textContent.trim()) return;

  const now = Date.now();
  if (!force && now - (aiThrottleMap[noteId] || 0) < 15000) return;

  aiThrottleMap[noteId] = now;
  aiSummaryInProgress.value = true;
  isAiLoading.value = true;
  aiStatusText.value = 'AI 正在总结标题...';
  aiDotColor.value = '#0071e3';
  isTitleShimmering.value = true;

  try {
    const response = await fetch('/api/summarize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: textContent }),
    });
    const data = await response.json();

    if (data.title) {
      const targetNote = notes.value.find((n) => n.id === noteId);
      if (targetNote && currentNoteId.value === noteId) {
        targetNote.title = data.title;
        targetNote.updatedAt = Date.now();
        saveNotes();
        if (
          document.activeElement !==
          document.querySelector('input[placeholder="无标题"]')
        ) {
          currentTitle.value = targetNote.title;
        }
      }
      lastSubmittedContent[noteId] = textContent.trim();
    }

    if (data.error) {
      aiStatusText.value = 'AI 服务开小差了';
      aiDotColor.value = '#ff3b30';
    } else {
      aiStatusText.value = 'AI 标题更新成功';
      aiDotColor.value = '#34c759';
      setTimeout(() => {
        if (aiStatusText.value === 'AI 标题更新成功') updateAIStatusDisplay();
      }, 3000);
    }
  } catch (error) {
    aiStatusText.value = 'AI 服务开小差了';
    aiDotColor.value = '#ff3b30';
    showCustomAlert('AI 总结失败', '网络或服务异常，请稍后重试');
  } finally {
    aiSummaryInProgress.value = false;
    isAiLoading.value = false;
    isTitleShimmering.value = false;
  }
};

const handleManualAiSummary = () => {
  if (!currentNote.value) return;
  if (!currentUser.value) {
    showCustomAlert('需要登录', 'AI 总结功能需要在设置中登录账户后才能使用');
    return;
  }
  if (aiSummaryInProgress.value) {
    showToast('AI 总结进行中，请稍候');
    return;
  }
  const plainText = getPlainSnippet(currentNote.value.body);
  if (!plainText) {
    showCustomAlert('无法总结', '便签内容为空，请先输入内容后再使用 AI 总结');
    return;
  }
  if (plainText.length < 10) {
    showCustomAlert(
      '内容太短',
      '当前仅 ' +
        plainText.length +
        ' 个字，至少需要 10 个字才能生成有意义的总结',
    );
    return;
  }
  triggerAISummary(currentNote.value.id, plainText, true);
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

onMounted(async () => {
  // 先加载本地数据，确保用户进入主界面就有内容
  loadLocalData();
  cleanupEmptyNotes();
  // 然后异步检查登录状态（不阻塞主界面）
  try {
    const me = await fetch('/api/auth/me');
    if (me.ok) {
      const d = await me.json();
      currentUser.value = { username: d.username };
      await loadUserData();
    }
  } catch (e) {
    // 网络错误时保持本地模式
  }
});

const handleQuillReady = (quill: any) => {
  quillInstance = quill;
  quill.on('text-change', () => {
    if (isInternalUpdate || !currentNoteId.value) return;
    const note = notes.value.find((n) => n.id === currentNoteId.value);
    if (note) {
      note.body = quill.root.innerHTML;
      note.updatedAt = Date.now();
      saveNotes();
      wordCount.value = quill.getText().trim().length;
    }
  });

  quill.root.addEventListener('focusout', (event: FocusEvent) => {
    const toolbar = document.querySelector('.ql-toolbar');
    if (toolbar && toolbar.contains(event.relatedTarget as Node)) return;
    if (isInternalUpdate || !currentNoteId.value) return;

    const note = notes.value.find((n) => n.id === currentNoteId.value);
    if (note) {
      note.body = quill.root.innerHTML;
      note.updatedAt = Date.now();
      saveNotes();
      triggerAISummary(currentNoteId.value, getPlainSnippet(note.body));
    }
  });

  if (currentNote.value) {
    currentTitle.value = currentNote.value.title;
    isInternalUpdate = true;
    quill.root.innerHTML = currentNote.value.body || '';
    isInternalUpdate = false;
    wordCount.value = quill.getText().trim().length;
  }
};

watch(currentNoteId, (newId) => {
  const note = notes.value.find((n) => n.id === newId);
  if (note && quillInstance) {
    currentTitle.value = note.title;
    isInternalUpdate = true;
    quillInstance.root.innerHTML = note.body || '';
    isInternalUpdate = false;
    wordCount.value = quillInstance.getText().trim().length;
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
      :aiSummaryInProgress="aiSummaryInProgress"
      :currentUser="currentUser"
      @titleInput="onTitleInput"
      @manualAiSummary="handleManualAiSummary"
      @openSettings="isSettingsOpen = true"
      @copyNote="copyCurrentNote"
      @deleteNote="deleteCurrentNote"
      @quillReady="handleQuillReady"
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
      :show="isSettingsOpen"
      v-model:summaryEnabled="aiConfig.summaryEnabled"
      v-model:authMode="authMode"
      v-model:authUsername="authForm.username"
      v-model:authPassword="authForm.password"
      :currentUser="currentUser"
      :authLoading="authLoading"
      :authError="authError"
      @close="isSettingsOpen = false"
      @saveConfig="saveAiConfig"
      @submitAuth="handleAuthSubmit"
      @logout="logout"
    />
  </div>
</template>
