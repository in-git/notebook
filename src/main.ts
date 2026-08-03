import '@icon-park/vue-next/styles/index.css';
// Quill 富文本编辑器样式（snow 主题，Apple 风格覆盖见 src/style.css）
import 'quill/dist/quill.snow.css';
import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

createApp(App).mount('#app');
