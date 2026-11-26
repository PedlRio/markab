import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'wxt'

// https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
    // Everything ships inside the extension and loads from disk, so one ~1 MB editor
    // chunk is fine — there is no network cost to split for.
    build: { chunkSizeWarningLimit: 1500 },
  }),
  manifest: {
    name: 'Markab',
    description: 'A fast Markdown notebook that lives in your new tab, with optional Obsidian vault sync.',
    // `unlimitedStorage` lifts the 10 MB chrome.storage.local cap, so pasted images
    // and long notes can never make a save fail silently.
    permissions: ['storage', 'unlimitedStorage'],
    action: { default_title: 'Open Markab' },
  },
})
