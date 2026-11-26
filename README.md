# Markab

A fast Markdown notebook that replaces Chrome's new tab page. Multiple notes and folders, slash commands, autosave, a privacy overlay, and optional one-way sync to an Obsidian vault.

## Install it in Chrome (2 minutes)

You need [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm run build
```

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and pick the **`.output/chrome-mv3`** folder
4. Open a new tab

To update later: `git pull && npm install && npm run build`, then click the ↻ reload icon on the Markab card in `chrome://extensions`.

> Always load `.output/chrome-mv3` from `npm run build`. A folder produced by `npm run dev` points at a local dev server and stops working once that server is off.

## Publish to the Chrome Web Store

```bash
npm run zip
```

This creates `.output/markab-<version>-chrome.zip`. Upload it at the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole). Bump `version` in `package.json` before each upload. The store asks you to justify the permissions:

- `storage`: notes and settings are saved locally in the browser.
- `unlimitedStorage`: notes can hold pasted images, so the 10 MB default cap is lifted to keep saves from failing.

Markab requests no host permissions and makes no network requests.

## Features

- **Notes and folders**: nested folders, drag a note onto a folder to move it, double-click a folder to rename it.
- **Markdown editor** (Tiptap 3): headings, lists, task lists (`[ ]` / `[x]`), quotes, code, links (`⌘K`), `==highlight==`, image paste/drop with resize, drag handles to reorder blocks.
- **Slash commands**: type `/` at the start of a word, or press `⌘/`.
- **Autosave**: saves 400 ms after you stop typing, and immediately when the tab closes.
- **Multiple tabs**: every open tab stays in sync, and no tab overwrites another's edits.
- **Privacy overlay**: new tabs open hidden (toggle with `⌘⇧H`). You can turn this off under **Aa** → *Hide notes when a new tab opens*.
- **Obsidian vault sync**: one-way. Notes are written as `.md` files with YAML frontmatter, and folders become subfolders. Chrome asks again for folder access after a restart; click **Allow access** in the sidebar.
- **Backup**: *Export backup* / *Import backup* (JSON) at the bottom of the sidebar. Use it to move notes between browsers or to a store-installed copy.

## Development

```bash
npm run dev        # opens a Chrome with the extension loaded and live reload
npm run typecheck  # TypeScript
npm test           # unit tests (Vitest)
npm run test:e2e   # builds, loads the extension in a real Chromium and drives it (Playwright)
npm run check      # all of the above
```

The first `test:e2e` run needs a browser: `npx playwright install chromium`.

## Stack

[WXT](https://wxt.dev) (Manifest V3, Vite) · React 19 · Tiptap 3 with `@tiptap/markdown` · Tailwind CSS 4 · Zustand 5 · Vitest · Playwright.
