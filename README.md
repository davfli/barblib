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

## Features (MVP)

- Library shelf with covers, author, progress; books are stored in the browser's local database (IndexedDB)
- Remembers your position per book
- Contents panel, progress slider, keyboard (← → PgUp PgDn Space, `t` = contents, Esc = back)
- Tap zones: left/right third turns pages, middle hides the bars
- Light / sepia / dark themes (dark mode also inverts PDFs), text size, pages or scroll layout
- Drag & drop, multi-file open, works offline once loaded

## Adding a format

1. Create `js/formats/<name>.js` exporting `{ id, label, extensions, detect, open }`.
   The full interface is documented in `js/formats/index.js`.
2. Add it to the `handlers` array in `js/formats/index.js`.

That's it. The library, settings, contents and progress UI work automatically.

## Layout

```
index.html, css/app.css      UI shell
js/app.js                    screens, controls, opening files
js/library.js                IndexedDB storage
js/formats/*.js              one file per format
vendor/foliate-js            ebook engine (MIT), includes pdf.js (Apache-2.0)
sw.js, manifest.webmanifest  offline + install
samples/                     test files (not needed in production)
```

Testing helper: `http://localhost:8642/?open=samples/test.pdf` opens a file from this folder.
