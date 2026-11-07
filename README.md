# Reader

An ebook / document reader that runs as an installable web app (PWA) on
Windows and phones. Everything runs locally: files are never uploaded.

## Formats

| Format | Handler |
|---|---|
| EPUB, PDF, MOBI, AZW, AZW3 (Kindle, DRM-free), FB2, CBZ | `js/formats/ebook.js` (foliate-js + pdf.js) |
| PNG, JPG, GIF, WebP, AVIF, BMP, SVG (several at once = one paged set) | `js/formats/image.js` |
| JSON, JSON Lines (.jsonl / .ndjson), GeoJSON | `js/formats/json.js` |

Not supported: KFX and DRM-protected Kindle files. Convert them to EPUB with Calibre first.

## Run on Windows

Double-click **`Start Reader.cmd`** (needs Python). It opens http://localhost:8642.
In Edge or Chrome, click the "Install app" icon in the address bar to get a desktop app.
After installing, `.epub`, `.pdf`, `.mobi`, `.azw3` and the other formats can be opened
from Explorer via *Open with → Reader*.

## Phones

A phone needs the app served over HTTPS, for example from GitHub Pages or Netlify.
Upload this folder without `samples/`, open the URL on the phone, then use "Add to Home Screen".

## Features

**Library**
- Folders you can nest, rename, delete; breadcrumbs; grid or list view; search
- Drag books and folders onto folders or breadcrumbs to move them (on phones: ⋯ → Move to…)
- Import files or a whole folder (keeps its sub-folders); drop files/folders anywhere on the window
- Images in the same folder become one paged set (scans, comics)

**Reading**
- Remembers your position per book; contents, progress slider
- Bookmarks (B or the ribbon button), listed with chapter, position and a short preview
- Floating notes window (N): drag anywhere, resize, collapse; *This book* and *General* notebooks;
  insert your current location or quote selected text
- Keyboard: ← → PgUp PgDn Space, `T` contents, `B` bookmark, `N` notes, `F` fullscreen, Esc back
- Tap zones: left/right third turns pages, middle hides the bars

**Comfort**
- Day and Bedtime profiles, each with its own theme, warm light and dimming; switch with the moon button
  or automatically on a schedule
- Themes: Light, Sepia, Dark, Night (dim amber on black); dark themes also apply to PDFs
- Warm light filter (cuts blue light) and extra dimming below the screen's minimum brightness
- Fonts (Book / Serif / Sans / Clear), text size, line spacing, line width, justify, pages or scroll
- Keep the screen on while reading

## Adding a format

1. Create `js/formats/<name>.js` exporting `{ id, label, extensions, detect, open }`.
   The full interface is documented in `js/formats/index.js`.
2. Add it to the `handlers` array in `js/formats/index.js`.

That's it. The library, settings, contents and progress UI work automatically.

## Layout

```
index.html, css/app.css      UI shell
js/app.js                    startup, settings panel, global keys and drops
js/shelf.js                  library: folders, import, drag & drop
js/reader.js                 reader screen, bookmarks, contents
js/notes.js                  floating notes window
js/settings.js               display/comfort settings, bedtime schedule, filters
js/ui.js                     icons, dialogs, menus, toast
js/library.js                IndexedDB storage
js/formats/*.js              one file per format
vendor/foliate-js            ebook engine (MIT), includes pdf.js (Apache-2.0)
sw.js, manifest.webmanifest  offline + install
samples/                     test files (not needed in production)
```

Testing helper: `http://localhost:8642/?open=samples/test.pdf` opens a file from this folder.
