/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

// quill-image-resize-module 没有官方 .d.ts，这里补一个最小化声明
declare module 'quill-image-resize-module' {
  const ImageResize: any;
  export default ImageResize;
}
