/**
 * This file will automatically be loaded by vite and run in the "renderer" context.
 * To learn more about the differences between the "main" and the "renderer" context in
 * Electron, visit:
 *
 * https://electronjs.org/docs/tutorial/process-model
 *
 * By default, Node.js integration in this file is disabled. When enabling Node.js integration
 * in a renderer process, please be aware of potential security implications. You can read
 * more about security risks here:
 *
 * https://electronjs.org/docs/tutorial/security
 *
 * To enable Node.js integration in this file, open up `main.ts` and enable the `nodeIntegration`
 * flag:
 *
 * ```
 *  // Create the browser window.
 *  mainWindow = new BrowserWindow({
 *    width: 800,
 *    height: 600,
 *    webPreferences: {
 *      nodeIntegration: true
 *    }
 *  });
 * ```
 */

// import './assets/styles/index.css';

// If you are encountering issues with type declarations for CSS imports,
// you can create a `declaration.d.ts` file in your project with the following content:
// declare module '*.css';

console.log('👋 This message is being logged by "renderer.ts", included via Vite');
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';

// createApp(App).mount('#app');

window.addEventListener('DOMContentLoaded', () => {
  const app = createApp(App);
  app.use(createPinia());
  app.mount('#app');
});
