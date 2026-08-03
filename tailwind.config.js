/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{vue,ts,tsx,js,jsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
  // 关闭 Preflight，避免覆盖 Quill 等第三方组件的基础样式
  corePlugins: {
    preflight: false,
  },
};
