# barbLib

Your ebook library: read EPUB, PDF, Kindle (MOBI/AZW3), FB2, CBZ, images and JSON on
Windows, Android and in any browser, with your books, positions, bookmarks and notes
synced through **your own Google Drive**.

**Open it:** <https://davfli.github.io/barblib/>

## Install

| Device | How |
|---|---|
| Windows | Open the link in Edge or Chrome → **Install** icon in the address bar. Or use the Windows package in `packages/`. |
| Android | Open the link in Chrome → ⋮ → **Install app**. Or install the APK in `packages/`. |
| iPhone / iPad | Open the link in Safari → Share → **Add to Home Screen**. |

Every installed copy loads barbLib from the site above, so **updates reach all devices
automatically**. When a new version is out, barbLib shows *"A new version is ready
→ Update now"*.

## Cloud library

One-time setup: [docs/google-drive-setup.md](docs/google-drive-setup.md). Then each
device: tap **☁ Connect** in the library bar.

- Books are stored as normal files in *My Drive → barbLib → books*; `library.json`
  holds positions, bookmarks, notes, folders.
- barbLib only has access to files it created (`drive.file`), never the rest of your Drive.
- Books from other devices appear with ☁ and download when opened; **⋯ → Remove
  download** frees space; deleting moves files to Drive's trash.
- Sync rules: per book, the newest change wins separately for reading position,
  bookmarks, notes, and title/folder. A deletion wins only if it's newer than the
  last change.
- The cloud icon in the library bar shows status: green synced, orange syncing,
  yellow tap to reconnect (Google sign-ins last about an hour), red error.

## Formats

| Format | Handler |
|---|---|
| EPUB, PDF, MOBI, AZW, AZW3 (Kindle, DRM-free), FB2, CBZ | `js/formats/ebook.js` (foliate-js + pdf.js) |
| PNG, JPG, GIF, WebP, AVIF, BMP, SVG (several at once = one paged set) | `js/formats/image.js` |
| JSON, JSON Lines (.jsonl / .ndjson), GeoJSON | `js/formats/json.js` |

Not supported: KFX and DRM-protected Kindle files. Convert them to EPUB with Calibre first.

## Features

**Library:** nested folders, breadcrumbs, grid/list view, search; drag books and folders
onto folders or breadcrumbs (phones: ⋯ → Move to…); import files or whole folders
(sub-folders kept); drop files/folders on the window; images in one folder become one set.

**Reading:** remembers your position; contents; bookmarks (B); floating notes window (N),
with *This book* and *General* notebooks, insert location, quote selection; keys
← → PgUp PgDn Space, T contents, B bookmark, N notes, F fullscreen, Esc back; tap zones.

**Comfort:** Day and Bedtime profiles (theme, warm light, dimming), automatic bedtime
schedule, Light/Sepia/Dark/Night themes (also for PDFs), fonts, size, line spacing, line
width, justify, pages or scroll, keep screen on.

## Releasing an update

```bash
python tools/release.py          # 1.0.0 -> 1.0.1   (or: minor / major / 1.2.3)
git commit -am "Release 1.0.1" && git push
```

GitHub Pages publishes within a minute; open apps offer the update. The Windows and
Android packages never need rebuilding for normal updates. Only rebuild them to change
the app icon, name or permissions. Keep `signing.keystore` from the Android package
safe and private: it is needed to publish newer APKs over the old one.

## Run locally

Double-click **`Start barbLib.cmd`** (needs Python) → <http://localhost:8642>.
It runs `tools/serve.py`, a dev server that disables browser caching so edits show on reload.
On `localhost` the service worker always uses the network too.
`http://localhost:8642/?open=samples/test.pdf` opens a file from this folder.

## Adding a format

1. Create `js/formats/<name>.js` exporting `{ id, label, extensions, detect, open }`
   (interface documented in `js/formats/index.js`).
2. Add it to `handlers` in `js/formats/index.js`.

## Layout

```
index.html, css/app.css      UI shell
js/app.js                    startup, settings panel, cloud & update UI, global keys
js/shelf.js                  library: folders, import, drag & drop
js/reader.js                 reader screen, bookmarks, contents
js/notes.js                  floating notes window
js/settings.js               display/comfort settings, bedtime schedule, filters
js/library.js                IndexedDB storage (with change times for sync)
js/cloud/drive.js            Google Drive client (sign-in, upload, download)
js/cloud/sync.js             sync engine
js/cloud/merge.js            merge rules (pure, tested)
js/config.js                 Google client ID
js/version.js, version.json  version (bumped by tools/release.py)
js/formats/*.js              one file per format
vendor/foliate-js            ebook engine (MIT), includes pdf.js (Apache-2.0) with its JBIG2/JPEG 2000
                             decoders; barbLib changes in pdf.js: decoder paths, background
                             pre-rendering of nearby pages (marked "barbLib:")
sw.js, manifest.webmanifest  offline + install
tests/fake-drive.js          in-memory Drive for testing sync
docs/                        setup guides
```
