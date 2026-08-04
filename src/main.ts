import '@icon-park/vue-next/styles/index.css';
import Antd from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';
import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

createApp(App).use(Antd).mount('#app');
