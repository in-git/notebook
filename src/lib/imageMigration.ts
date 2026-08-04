// 登录后本地数据迁移：把笔记 body 中内嵌的本地图片（base64 data URL）
// 上传到服务器，拿到网络地址后替换掉原来的本地图片。
// 已经是网络地址（http/https）的图片不处理。
//
// 典型场景：用户在未登录时写了一批带图的笔记，图片以 base64 形式直接嵌在
// 笔记 HTML 里（见 EditorWorkspace.vue 的 imageUploader 未登录分支）。
// 登录后，这些图片并没有真正存到服务器，需要一次性迁移到云端。

import { fileApi } from './api';
import type { Note } from '../types/note';

// 判断一个 src 是否为「本地图片」（需要上传迁移）
//  - data: 开头的 base64 图片 → 本地
//  - http:// / https:// / // 开头 → 网络图片，跳过
//  - blob: 开头 → 运行时临时地址，理论上不会持久化，跳过
export const isLocalImageSrc = (src: string): boolean => {
  const s = (src || '').trim();
  if (s.startsWith('data:')) return true;
  if (
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('//') ||
    s.startsWith('blob:')
  )
    return false;
  return false;
};

// 把 data URL 还原成 File，便于走与编辑器一致的 upload 流程
const dataUrlToFile = async (dataUrl: string, fallbackName = 'image.webp'): Promise<File | null> => {
  try {
    const [head, base64] = dataUrl.split(',');
    if (!base64) return null;
    const mimeMatch = head.match(/data:([^;]+);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/webp';
    const ext = mime.split('/')[1] || 'webp';
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    const name = fallbackName.replace(/\.[^.]+$/, '') + '.' + ext;
    return new File([bytes], name, { type: mime });
  } catch {
    return null;
  }
};

// 从 upload 返回值中尽可能稳健地提取图片网络地址
const extractUploadUrl = (result: unknown): string | null => {
  if (!result || typeof result !== 'object') return null;
  const obj = result as Record<string, unknown>;
  const candidates = ['url', 'src', 'link', 'path', 'fileUrl'];
  for (const key of candidates) {
    const v = obj[key];
    if (typeof v === 'string' && v && !v.startsWith('data:')) return v;
  }
  // 兼容 data 内嵌套一层
  const inner = obj.data;
  if (inner && typeof inner === 'object') {
    const innerObj = inner as Record<string, unknown>;
    for (const key of candidates) {
      const v = innerObj[key];
      if (typeof v === 'string' && v && !v.startsWith('data:')) return v;
    }
  }
  return null;
};

// 迁移单条笔记：扫描 body 里的本地图片并上传替换。
// 返回新的 body 字符串；若没有任何本地图片，返回 null（表示无需更新）。
export const migrateNoteImages = async (
  body: string,
): Promise<string | null> => {
  if (!body || typeof body !== 'string') return null;

  const parser = new DOMParser();
  const doc = parser.parseFromString(body, 'text/html');
  const imgs = Array.from(doc.querySelectorAll('img'));
  if (imgs.length === 0) return null;

  let changed = false;
  for (const img of imgs) {
    const src = img.getAttribute('src') || '';
    if (!isLocalImageSrc(src)) continue;

    const file = await dataUrlToFile(src);
    if (!file) {
      // 无法还原为文件，保留原样不处理
      continue;
    }
    try {
      const result = await fileApi.upload(file);
      const url = extractUploadUrl(result);
      if (url) {
        img.setAttribute('src', url);
        changed = true;
      }
    } catch (e) {
      // 单张图片上传失败不阻断其它图片 / 其它笔记的迁移
      console.warn('本地图片上传失败，跳过该图片:', e);
    }
  }

  return changed ? doc.body.innerHTML : null;
};

// 批量迁移：遍历所有本地笔记，把本地图片上传到服务器并替换。
// 返回「图片被替换过」的笔记（最新内容）；调用方负责把这些笔记保存/同步到云端。
// 已经没有本地图片的笔记不会被返回，避免无意义的覆盖。
export const migrateLocalNotesImages = async (
  notes: Note[],
): Promise<Note[]> => {
  if (!Array.isArray(notes) || notes.length === 0) return [];

  const migrated: Note[] = [];
  for (const note of notes) {
    const newBody = await migrateNoteImages(note.body || '');
    if (newBody !== null) {
      migrated.push({ ...note, body: newBody });
    }
  }
  return migrated;
};

// 判断一组笔记里是否还存在本地图片（用于决定是否触发迁移）
export const hasLocalImages = (notes: Note[]): boolean => {
  if (!Array.isArray(notes)) return false;
  return notes.some((n) => {
    const body = n.body || '';
    if (!body.includes('data:image')) return false;
    const parser = new DOMParser();
    const doc = parser.parseFromString(body, 'text/html');
    return Array.from(doc.querySelectorAll('img')).some((img) =>
      isLocalImageSrc(img.getAttribute('src') || ''),
    );
  });
};
