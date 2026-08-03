export interface Note {
  id: number;
  title: string;
  body: string;
  updatedAt: number;
  createdAt: number;
  pinned: boolean;
  color: string | null;
  order: number;
}

export interface User {
  username: string;
}

export interface AiConfig {
  summaryEnabled: boolean;
}

export interface NoteColor {
  name: string;
  value: string | null;
  hex: string;
}

// 7 色分类：value=null 代表默认灰色；hex 用于 UI 展示
export const NOTE_COLORS: NoteColor[] = [
  { name: '默认', value: null, hex: '#eeeeee' },
  { name: '红色', value: '#FF3B30', hex: '#FF3B30' },
  { name: '橙色', value: '#FF9500', hex: '#FF9500' },
  { name: '黄色', value: '#FFCC00', hex: '#FFCC00' },
  { name: '绿色', value: '#34C759', hex: '#34C759' },
  { name: '蓝色', value: '#007AFF', hex: '#007AFF' },
  { name: '白色', value: '#FFFFFF', hex: '#FFFFFF' },
];
