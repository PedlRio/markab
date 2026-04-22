# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev        # Vite dev server on :5173 with CRXJS HMR for MV3
npm run build      # tsc --noEmit && vite build → dist/ (load-unpacked target)
npm run typecheck  # type-check only, no emit
```

There is no test runner or linter configured. `npm run build` is the authoritative check — it runs `tsc --noEmit` first, so a successful build implies a clean typecheck.

Loading the extension: `chrome://extensions` → Developer mode → Load unpacked → pick `dist/`. Open a new tab to see changes (the editor replaces the default new tab via `chrome_url_overrides.newtab` in [manifest.json](manifest.json)).

## Architecture

**Chrome Extension (Manifest V3)** built with Vite + CRXJS. Three entry points declared in [manifest.json](manifest.json): the new-tab page ([src/newtab/index.html](src/newtab/index.html)), the toolbar popup ([src/popup/index.html](src/popup/index.html)), and a service worker ([src/background/index.ts](src/background/index.ts)). CRXJS wires all three into a single Vite build — never add a separate build step per entry point.

### State and persistence layers

Three distinct stores, each with its own persistence strategy — do not conflate them:

1. **[noteStore.ts](src/store/noteStore.ts)** (Zustand) — notes, folders, active note, vault metadata, privacy flag. Persisted to `chrome.storage.local` on every mutation via an internal `storageSet` helper. `hydrate()` runs once on app mount from [App.tsx](src/newtab/App.tsx); the UI shows a Loading state until `isHydrated` is true. `isHidden` always hydrates to `true` (privacy-first — every new tab starts hidden).
2. **[prefsStore.ts](src/store/prefsStore.ts)** (Zustand) — editor typography prefs (font size, content width). Separate store, separate storage key (`editorPrefs`). Applied via CSS custom properties `--ntm-font-size` / `--ntm-content-width` injected on the Editor root.
3. **[lib/idb.ts](src/lib/idb.ts) → IndexedDB** — stores the `FileSystemDirectoryHandle` for vault sync. Required because `chrome.storage` cannot serialize file handles. Keyed lookups only; do not use for anything else.

### Obsidian vault sync

[lib/vault.ts](src/lib/vault.ts) wraps the File System Access API. Flow: user clicks Connect → `pickVault()` calls `showDirectoryPicker()` → handle is persisted in IndexedDB → `verifyPermission(handle, requestIfNeeded)` re-checks on each session (permission can expire). Notes are serialized as Markdown with YAML frontmatter; folder hierarchy maps to subdirectories. `writeNote(handle, note, folderPath, previous?)` accepts a `previous` location so renames/moves delete the old file after writing the new one. `syncNote` in the store is fire-and-forget (`void syncNote(...)`) — failures set `syncError` but never block UI updates.

### The Tiptap editor

[Editor.tsx](src/newtab/components/Editor.tsx) composes a large extension stack. Order matters for some of them:

- `StarterKit` baseline + `Highlight`, `TaskList`/`TaskItem`, `Typography`, `Placeholder`, `Link`, `Markdown` (import/export).
- Custom extensions in [src/newtab/extensions/](src/newtab/extensions/):
  - `TaskInputRules` — converts `[ ]`/`[x]` at line start into task items. Must run *after* StarterKit so bullet input rules don't swallow `- ` first.
  - `SmilieReplacer`, `ColorHighlighter` (ProseMirror `DecorationSet` for hex swatches), `ResizableImage`.
- `GlobalDragHandle` + `AutoJoiner` (the handle selector `.drag-handle` is styled in [index.css](src/index.css); a document-level `mousemove` listener in Editor.tsx overrides the library's too-aggressive `.hide` toggle to keep the handle reachable).
- Slash commands: plain `/` keydown opens [CommandPalette.tsx](src/newtab/components/CommandPalette.tsx) with a `slashRange` so the `/` character is deleted before the command runs. `⌘/` also opens it (without a range). `⌘K` invokes the link prompt.

Autosave is debounced 800ms per note per field (content and title have independent timers). `onUpdate` pulls Markdown from `tiptap-markdown`'s storage — do not serialize from the JSON doc directly.

Image paste goes through [lib/image.ts](src/lib/image.ts) (`compressImageFile`) before being inserted, capping base64 size to avoid blowing `chrome.storage.local`'s 10MB quota.

### Privacy overlay

[PrivacyOverlay.tsx](src/newtab/components/PrivacyOverlay.tsx) is a full-screen blur that reads `isHidden` from the store. Toggle via `⌘⇧H` or click. Because every new tab starts hidden, any "is the user returning to an existing session" logic must account for the overlay — don't assume the editor is visible on mount.

### Styling conventions

Tailwind + a hand-authored block of ProseMirror overrides in [index.css](src/index.css). The editor expects CSS variables to be set on an ancestor: `--ntm-font-size`, `--ntm-content-width`. The `.ntm-editor` class is the styling anchor for everything ProseMirror-related — global selectors on `.ProseMirror` would leak, so keep them scoped under `.ntm-editor .ProseMirror`.

## Constraints and non-obvious gotchas

- **`chrome.storage.local` 10MB quota** — Images are compressed before paste ([lib/image.ts](src/lib/image.ts)) for this reason. Do not store raw base64 blobs elsewhere.
- **`FileSystemDirectoryHandle` is not serializable** — It cannot go into `chrome.storage.local`. All vault handle persistence must go through [lib/idb.ts](src/lib/idb.ts).
- **`isHidden` always hydrates to `true`** — This is intentional (privacy-first). Any logic that assumes the editor is visible on mount is wrong.
- **Tiptap extension order is load-order-sensitive** — `TaskInputRules` must come after `StarterKit`; changing the order in [Editor.tsx](src/newtab/components/Editor.tsx) can break input rules silently.
- **Serialize content via `tiptap-markdown`, not JSON** — `onUpdate` must call `editor.storage.markdown.getMarkdown()`. Serializing from `editor.getJSON()` bypasses the markdown storage and produces different output.
- **`syncNote` is fire-and-forget** — Vault writes never block UI updates. Errors land in `syncError` on the store but do not throw. Do not `await` vault sync in user-facing flows.
- **No test runner configured** — `npm run build` (which runs `tsc --noEmit` first) is the only automated correctness check. A successful build implies a clean typecheck.
- **CRXJS single build** — All three entry points (newtab, popup, service worker) are built together by Vite. Never add a separate build script per entry point.
- **Service worker is ephemeral (MV3)** — The background script cannot hold long-lived state. All persistent state lives in `chrome.storage.local` or IndexedDB.
