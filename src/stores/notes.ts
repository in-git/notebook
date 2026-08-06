import { defineStore } from 'pinia';
import type { Note } from '../types/note';

// 与原 App.vue 中保持一致的本地存储 key（兼容历史数据）
const LOCAL_NOTES_KEY = 'apple_notes_data_ai';

const ensureNoteShape = (note: Note, index: number): Note => ({
  ...note,
  createdAt: note.createdAt ?? note.id ?? Date.now(),
  pinned: note.pinned ?? false,
  color: note.color ?? null,
  order: note.order ?? index,
});

interface NotesState {
  notes: Note[];
}

/**
 * 便签数据 store
 * - 本地模式（未登录）：使用 pinia-plugin-persistedstate 自动持久化到 localStorage
 * - 云端模式（已登录）：在 App.vue 中通过 actions 与后端同步
 */
export const useNotesStore = defineStore('notes', {
  state: (): NotesState => ({
    notes: [],
  }),
  actions: {
    /**
     * 从原 localStorage key 一次性迁移历史数据，避免重复迁移
     * 已存在持久化数据时跳过
     */
    migrateLegacy() {
      if (this.notes.length > 0) return;
      try {
        const raw = localStorage.getItem(LOCAL_NOTES_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.notes = parsed.map((n: Note, i: number) =>
            ensureNoteShape(n, i),
          );
        }
      } catch (e) {
        console.error('迁移历史本地笔记失败:', e);
      }
    },

    /** 清空空便签（无标题且无正文） */
    cleanupEmpty() {
      const isEmpty = (n: Note) => {
        const hasTitle = (n.title || '').trim().length > 0;
        const hasBody =
          (() => {
            const div = document.createElement('div');
            div.innerHTML = n.body || '';
            return (div.textContent || '').trim().length > 0;
          })();
        return !hasTitle && !hasBody;
      };
      this.notes = this.notes.filter((n) => !isEmpty(n));
    },

    setNotes(notes: Note[]) {
      this.notes = notes.map((n, i) => ensureNoteShape(n, i));
    },

    upsertNote(note: Note) {
      const idx = this.notes.findIndex((n) => n.id === note.id);
      if (idx >= 0) {
        this.notes[idx] = ensureNoteShape(note, idx);
      } else {
        this.notes.unshift(ensureNoteShape(note, this.notes.length));
      }
    },

    deleteNote(id: number) {
      this.notes = this.notes.filter((n) => n.id !== id);
    },

    togglePin(id: number) {
      const note = this.notes.find((n) => n.id === id);
      if (note) note.pinned = !note.pinned;
    },

    setNoteColor(id: number, color: string | null) {
      const note = this.notes.find((n) => n.id === id);
      if (note) {
        note.color = color;
        note.updatedAt = Date.now();
      }
    },

    updateNoteBody(id: number, body: string) {
      const note = this.notes.find((n) => n.id === id);
      if (note) {
        note.body = body;
        note.updatedAt = Date.now();
      }
    },

    updateNoteTitle(id: number, title: string) {
      const note = this.notes.find((n) => n.id === id);
      if (note) {
        note.title = title;
        note.updatedAt = Date.now();
      }
    },

    /** 拖拽后重排顺序 */
    reorderAfterDrop(sourceId: number, targetId: number, isBefore: boolean) {
      const sourceNote = this.notes.find((n) => n.id === sourceId);
      const targetNote = this.notes.find((n) => n.id === targetId);
      if (!sourceNote || !targetNote || sourceNote.pinned !== targetNote.pinned)
        return;

      const sorted = [...this.notes].sort((a, b) => {
        if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
        return a.order - b.order;
      });

      const sourceIdx = sorted.findIndex((n) => n.id === sourceNote.id);
      const arr = sorted.slice();
      const [moved] = arr.splice(sourceIdx, 1);
      let targetIdx = arr.findIndex((n) => n.id === targetNote.id);
      if (!isBefore) targetIdx += 1;
      arr.splice(targetIdx, 0, moved);
      arr.forEach((n, i) => {
        n.order = i;
      });
      this.notes = arr;
    },

    /**
     * 清空持久化的本地数据（云端同步成功后调用）
     * 仅移除 localStorage 中的 key，避免下次启动重复迁移历史数据。
     * 注意：不要清空内存中的 this.notes，否则合并结果会丢失、界面显示为空。
     * pinia-plugin-persistedstate 仍会把当前内存数据写回该 key，
     * 云端模式下以云端为准，本地副本仅作缓存。
     */
    clearPersisted() {
      try {
        localStorage.removeItem(LOCAL_NOTES_KEY);
      } catch {
        /* noop */
      }
    },
  },
  persist: {
    key: LOCAL_NOTES_KEY,
    storage: localStorage,
  },
});
