import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { unpluginIcons } from 'unplugin-icons/vite'

export default defineConfig({
  plugins: [
    tailwindcss(),
    unpluginIcons({
      autoInstall: true,
    }),
  ],
})