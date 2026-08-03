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

// sm-crypto 没有官方 .d.ts，这里补一个最小化声明
declare module 'sm-crypto' {
  interface Sm2 {
    doEncrypt(msg: string, publicKey: string, mode: 0 | 1): string;
    doDecrypt(encryptData: string, privateKey: string, mode: 0 | 1): string;
  }
  interface SmCrypto {
    sm2: Sm2;
  }
  const smCrypto: SmCrypto;
  export default smCrypto;
}
