# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Commands

```bash
npm run dev        # WXT dev mode: launches Chrome with the extension + live reload
npm run build      # production build → .output/chrome-mv3 (the "Load unpacked" folder)
npm run zip        # Chrome Web Store upload → .output/markab-<version>-chrome.zip
npm run typecheck  # tsc --noEmit
npm test           # Vitest unit tests (tests/unit)
npm run test:e2e   # build + Playwright: loads the real extension in Chromium (tests/e2e)
npm run check      # typecheck + unit + e2e — run before calling a change done
```

Never commit `.output/` or a dev build. The original version of this repo broke because a dev build (pointing at `localhost:5173`) was committed and loaded as the extension.

## Architecture

WXT + React 19, Manifest V3. WXT generates the manifest from `wxt.config.ts` and from the files in `src/entrypoints/`:

- `entrypoints/newtab/`: the app (overrides the new tab page).
- `entrypoints/background.ts`: only opens a new tab when the toolbar icon is clicked.

`src/` layout: `components/` (UI), `editor/` (Tiptap extensions + `buildExtensions`), `lib/` (storage, vault, idb, image, types), `store/` (Zustand).

### Persistence ([src/lib/storage.ts](src/lib/storage.ts))

- One key per note (`note:<id>`), plus `folders`, `prefs`, `vaultMeta`, `schema`. Never go back to a single notes array: several new tabs are open at once, and whole-array writes made tabs overwrite each other's notes.
- Other tabs pick up changes via `storage.subscribe` (`storage.onChanged`). The notes store ignores an incoming note older than its own copy (`updatedAt`), so an echo can't roll back newer local typing.
- `migrate()` converts the v1 layout (`notes` array, `editorPrefs`). It is driven by the presence of the legacy keys, so it is idempotent and safe if two tabs run it at once.
- `unlimitedStorage` is granted; pasted images are still compressed ([lib/image.ts](src/lib/image.ts)).

### Stores

- [store/notes.ts](src/store/notes.ts): notes, folders, active note, privacy flag, vault status. The `FileSystemDirectoryHandle` lives in a closure variable (not state) and in IndexedDB ([lib/idb.ts](src/lib/idb.ts); the DB name `ntm` is kept for compatibility). Vault writes go through a serial queue, are fire-and-forget, and errors land in `syncError`.
- [store/prefs.ts](src/store/prefs.ts): font size, width, `hideOnOpen`. `App` loads prefs first, then hydrates notes with `hideOnOpen`.

### Vault sync ([src/lib/vault.ts](src/lib/vault.ts))

Chrome usually returns a stored handle as `'prompt'` after a restart. The store then sets `vaultStatus: 'needs-permission'` and the sidebar shows **Allow access**. `requestPermission` only works inside a click handler. `writeNote` writes the new file before deleting the old one on rename or move.

### Two editors, chosen in prefs (`prefs.editor`)

- `livePreview` (default, prototype): [LivePreviewEditor.tsx](src/components/LivePreviewEditor.tsx), a CodeMirror 6 editor over the raw Markdown with Obsidian-style Live Preview. Code lives in [src/editor-cm/](src/editor-cm/):
  - `syntax.ts`: Lezer extensions for `==highlight==` and `[[wikilinks]]`.
  - `livePreview.ts`: a ViewPlugin that hides syntax with decorations unless the cursor touches it. It never rewrites text. Inline marks reveal when the selection touches the node; line-level marks (`#`, `>`, fences) reveal when the cursor is on the line. With the editor blurred, everything renders.
  - `widgets.ts`: checkbox (edits `[ ]`↔`[x]` on click), bullet, hr, image, callout title, code language label.
  - `setup.ts`: keymap (⌘B/I/E/K/L, ⇧⌘X), link clicks (`[[x]]` → `openNoteByTitle`, which creates the note if it's missing), image paste, and the Live Preview ⇄ Source mode compartment.
  - `theme.css`: tokens named after Obsidian's public CSS-variable API (`--background-primary`, `--h1-size`, `--callout-*`…). The values are Markab's own; never paste Obsidian's `app.css` (it's proprietary). Class names mirror Obsidian's (`HyperMD-header-N`, `cm-strong`, `task-list-item-checkbox`…) so theme snippets port easily.
- `classic`: the Tiptap editor below. Both read and write the same Markdown, so switching is lossless (covered by an e2e test).

e2e: [tests/e2e/fixtures.ts](tests/e2e/fixtures.ts) has an `engine` option. `extension.spec.ts` runs on `classic` and `live-preview.spec.ts` on `livePreview`.

### Workspace layout (Obsidian-style)

[App.tsx](src/components/App.tsx): `Ribbon` | `Sidebar` (resizable; Files/Search tabs; vault switcher) | `TabBar` + editor (`ViewHeader` with back/forward, breadcrumb, mode toggle, more menu). The settings live in `SettingsModal` (ribbon gear). Shared primitives are in [ui.tsx](src/components/ui.tsx): `ClickableIcon`, `Menu`/`useMenu` (context menus), `Modal`, `SettingItem`, `Toggle`, `Segmented`. Chrome state (sidebar open/width, back/forward history) is in [store/ui.ts](src/store/ui.ts), per browser via localStorage. Icons are Lucide, the same set Obsidian uses. The `.mk-theme` tokens apply to the whole app.

### Folding ([src/editor-cm/folding.ts](src/editor-cm/folding.ts))

A chevron widget sits in the left margin of headings and of list items that have children. It shows on hover, and always when folded. The ranges come from lang-markdown's fold service: a heading folds its section down to the next heading of the same or higher level. Folds are kept per note in localStorage (`markab:folds:<id>`) by line number, and never change the Markdown.

### Classic editor ([src/components/Editor.tsx](src/components/Editor.tsx))

- `buildExtensions()` in [editor/extensions.ts](src/editor/extensions.ts) is the single schema, shared with the Markdown round-trip tests. `TaskInputRules` must stay after StarterKit.
- Content is Markdown: load with `contentType: 'markdown'` and save with `editor.getMarkdown()`. Image width persists as Obsidian's `![alt|320](src)`.
- **The `useEditor` options object is created once (`useState`) and must stay referentially stable.** `useEditor` re-applies options whose identity changes on every render, and re-applying mid-typing drops keystrokes. Put changing values behind refs.
- Saves are debounced 400 ms and flushed on unmount, `pagehide` and `visibilitychange`.
- An external change to the open note (another tab) is applied only while the editor isn't focused.
- `/` is handled in `handleTextInput` (it inserts the slash itself so the range is exact). The palette focuses the editor with `editor.view.focus()` synchronously, because Tiptap's `focus()` is a frame late and loses fast keystrokes.
- A new note autofocuses the title input. Don't add Tiptap `autofocus`: it is delayed and steals focus.
- `⌘⇧H` (privacy) is caught in the capture phase in [PrivacyOverlay.tsx](src/components/PrivacyOverlay.tsx), so it beats Highlight's own `Mod-Shift-h`.

### Styling

Tailwind 4 (`@import 'tailwindcss'` in [styles.css](src/styles.css)) plus hand-written ProseMirror rules scoped under `.mk-editor`. CSS variables on the editor root: `--mk-font-size`, `--mk-content-width`.

### Icons

`public/icon/*.png` are generated from `scripts/icon.svg` with `node scripts/make-icons.mjs`.
