# new-tab-mark

A markdown editor Chrome extension that replaces the new tab page. Supports multiple notes with folder organization, autosave, privacy overlay, and Obsidian vault sync via the File System Access API.

## Tech Stack

- **Vite + CRXJS** — build pipeline and HMR for Chrome extensions
- **React 18 + TypeScript 5** — UI with strict typing
- **Tiptap** — WYSIWYG editor with markdown export (`tiptap-markdown`)
- **Tailwind CSS** — utility-first styling (dark mode enforced)
- **Zustand** — global state persisted to `chrome.storage.local`
- **Manifest V3** — service worker, no persistent background page

## Setup

### Prerequisites

- Node.js 18+
- npm 9+

### Install & Run

```bash
npm install
npm run dev
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle, top-right)
3. Click **Load unpacked**
4. Select the `dist/` folder

Open a new tab to see the editor.

### Production Build

```bash
npm run build
```

Built extension output is in `dist/`.

## Project Structure

```
src/
├── background/              # Service worker (MV3, typed messages)
├── newtab/                  # New tab page — main UI
│   ├── components/
│   │   ├── Editor.tsx       # Tiptap editor, autosave (800ms debounce)
│   │   ├── Sidebar.tsx      # Note list, folders, vault controls
│   │   ├── CommandPalette.tsx  # Slash command palette (/)
│   │   ├── PrivacyOverlay.tsx  # Full-screen blur (⌘⇧H)
│   │   └── TypographyPopover.tsx  # Font size & content width settings
│   ├── extensions/          # Custom Tiptap extensions
│   │   ├── ColorHighlighter.ts   # Hex color swatches inline
│   │   ├── TaskInputRules.ts     # [ ] / [x] → task items
│   │   ├── SmilieReplacer.ts     # :) → emoji
│   │   └── ResizableImage.tsx    # Resizable images with drag handles
│   ├── App.tsx
│   ├── index.html
│   └── main.tsx
├── popup/                   # Extension toolbar popup (note count, vault status)
├── store/
│   ├── noteStore.ts         # Notes, folders, vault metadata → chrome.storage.local
│   └── prefsStore.ts        # Typography prefs → chrome.storage.local
├── lib/
│   ├── vault.ts             # Obsidian vault sync (File System Access API)
│   ├── idb.ts               # IndexedDB wrapper (FileSystemDirectoryHandle)
│   └── image.ts             # Image compression before paste
├── types/
│   └── index.ts             # Note, Folder, shared types
└── index.css                # Tailwind base + ProseMirror scoped overrides
```

## Key Features

- **Multi-note + folders** — hierarchical folder tree with drag-to-move
- **Autosave** — 800ms debounce per field, fire-and-forget
- **Privacy overlay** — every new tab starts hidden; reveal with `⌘⇧H`
- **Slash commands** — `/` opens command palette (headings, lists, code, etc.)
- **Obsidian vault sync** — one-way write via File System Access API; notes serialized as Markdown with YAML frontmatter
- **Configurable typography** — font size (13–22px) and content width (Narrow/Medium/Wide/Full)
- **Image paste** — auto-compressed before insertion to respect `chrome.storage.local` quota

## Roadmap

- **Phase 1 (done)** — Editor, sidebar, multi-note, folder organization, chrome.storage.local persistence, privacy overlay, command palette, typography settings, Obsidian vault write sync
- **Phase 2** — Markdown toolbar, advanced keyboard shortcuts, global search, tag filtering, note versioning / trash
- **Phase 3** — Bi-directional Obsidian vault sync (read external changes), collaboration, plugin system
