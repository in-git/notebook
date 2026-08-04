import '@icon-park/vue-next/styles/index.css';
import Antd from 'ant-design-vue';
import 'ant-design-vue/dist/reset.css';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import './style.css';

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

const app = createApp(App);
app.use(pinia);
app.use(Antd);
app.mount('#app');
