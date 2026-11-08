// Sync engine: keeps this device's library and the barbLib folder in Google Drive
// in step.
//
// Drive layout (all visible in "My Drive"):
//   barbLib/
//     library.json   ← index: books, folders, positions, bookmarks, notes, deletions
//     books/         ← the book files themselves (normal files)
//     covers/        ← small cover thumbnails
//
// A sync round: download library.json → merge with this device → apply to this device
// → upload new books + covers → upload library.json if anything changed
// → empty the trash queue. Books that only exist in the cloud show on the shelf and
// download when opened.
import * as lib from '../library.js'
import * as realDrive from './drive.js'
import { merge, pickSyncFields, sameSnapshot } from './merge.js'
import { DRIVE_FOLDER } from '../config.js'

let drive = realDrive
/** Tests swap in an in-memory Drive. */
export const useDrive = d => { drive = d }

const STATE_KEY = 'cloud'
let state = null         // { connected, email, rootId, booksId, coversId, libraryId, lastSync }
let status = { phase: 'off', detail: '' } // off | idle | syncing | auth | error | offline
const listeners = new Set()
export const onStatus = fn => { listeners.add(fn); fn(status, state) }
function setStatus(phase, detail = '') {
  status = { phase, detail }
  for (const fn of listeners) fn(status, state)
}
export const getStatus = () => status
export const getState = () => state

async function saveState() { await lib.setKV(STATE_KEY, state) }

// ---------------- connect / disconnect ----------------
export async function init() {
  state = (await lib.getKV(STATE_KEY)) ?? null
  if (!state?.connected) { setStatus('off'); return }
  setStatus(drive.hasToken() ? 'idle' : 'auth', drive.hasToken() ? '' : 'Tap to reconnect')
  drive.preload?.()
  if (!bound) {
    bound = true
    addEventListener('library-change', () => requestSync(4000))
    addEventListener('online', () => requestSync(500))
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') requestSync(500) })
    setInterval(() => requestSync(0), 3 * 60_000)
  }
  requestSync(300)
}
let bound = false

/** Call from a click. */
export async function connect({ consent = true } = {}) {
  await drive.signIn({ consent, hint: state?.email })
  const me = await drive.about()
  const rootId = await drive.findOrCreateFolder(DRIVE_FOLDER)
  const [booksId, coversId] = await Promise.all([
    drive.findOrCreateFolder('books', rootId), drive.findOrCreateFolder('covers', rootId)])
  const wasConnected = state?.connected
  state = { ...state, connected: true, email: me.user?.emailAddress ?? '', rootId, booksId, coversId }
  await saveState()
  if (!wasConnected) await init()
  setStatus('idle')
  return syncNow()
}

/** Call from a click when the hourly sign-in expired. */
export async function reconnect() {
  if (!state?.connected) return connect()
  await drive.signIn({ consent: false, hint: state.email })
  setStatus('idle')
  return syncNow()
}

export async function disconnect() {
  drive.signOut()
  state = { connected: false }
  await saveState()
  setStatus('off')
}

// ---------------- scheduling ----------------
let timer = null
let running = null
let again = false
export function requestSync(delay = 2000) {
  if (!state?.connected) return
  clearTimeout(timer)
  timer = setTimeout(() => syncNow().catch(() => {}), delay)
}

export async function syncNow() {
  if (!state?.connected) return
  if (running) { again = true; return running }
  if (!navigator.onLine) { setStatus('offline', 'Offline. Changes sync when you are back online'); return }
  if (!drive.hasToken()) { setStatus('auth', 'Tap to reconnect'); return }
  running = (async () => {
    try {
      do { again = false; await round() } while (again)
      state.lastSync = Date.now()
      await saveState()
      setStatus('idle')
    } catch (e) {
      if (e instanceof realDrive.NeedAuthError || e?.name === 'NeedAuthError') setStatus('auth', 'Tap to reconnect')
      else { console.error(e); setStatus('error', e.message) }
      throw e
    } finally { running = null }
  })()
  return running
}

// ---------------- one round ----------------
async function localSnapshot() {
  const [books, folders, deleted, general] = await Promise.all([
    lib.listBooks(), lib.listFolders(), lib.getTombstones(), lib.getGeneralNotes()])
  return {
    books: Object.fromEntries(books.map(b => [b.id, pickSyncFields(b)])),
    folders: Object.fromEntries(folders.map(f => [f.id, { id: f.id, name: f.name, parentId: f.parentId ?? null, at: f.at || f.createdAt || 0 }])),
    deleted, general,
  }
}

async function round() {
  setStatus('syncing', 'Checking for changes…')
  // 1. read the cloud index
  if (!state.libraryId) state.libraryId = (await drive.findFile('library.json', state.rootId))?.id ?? null
  let remote = null
  if (state.libraryId) {
    try { remote = await drive.downloadJSON(state.libraryId) }
    catch (e) { if (/404/.test(e.message)) state.libraryId = null; else throw e }
  }

  // 2. merge and apply here
  const local = await localSnapshot()
  let merged = merge(local, remote)
  await applyLocally(local, merged)

  // 3. upload books that are only on this device
  const toUpload = (await lib.listBooks()).filter(b => b.local !== false && !b.files?.length && merged.books[b.id])
  for (const [i, book] of toUpload.entries()) {
    const files = await lib.getFiles(book.id)
    if (!files?.length) continue
    const total = files.reduce((n, f) => n + f.size, 0)
    let doneBytes = 0
    const uploaded = []
    for (const f of files) {
      const r = await drive.upload({
        blob: f, name: f.name, parentId: state.booksId, appProperties: { barblibId: book.id.slice(0, 100) },
        onProgress: p => setStatus('syncing', `Uploading ${i + 1} of ${toUpload.length}: ${book.title} ${Math.round(((doneBytes + p * f.size) / total) * 100)}%`),
      })
      doneBytes += f.size
      uploaded.push({ driveId: r.id, name: f.name, size: f.size, type: f.type || '' })
    }
    let coverId = book.coverId ?? null
    if (book.cover && !coverId) {
      coverId = (await drive.upload({ blob: book.cover, name: `${uploaded[0].driveId}.jpg`, parentId: state.coversId, mimeType: 'image/jpeg' })).id
    }
    await lib.silently(() => lib.putBook({ ...book, files: uploaded, coverId }))
    merged.books[book.id] = { ...merged.books[book.id], files: uploaded, coverId }
  }

  // 4. covers for books that got their metadata after upload
  for (const b of await lib.listBooks()) {
    const m = merged.books[b.id]
    if (m && b.cover && !m.coverId && m.files?.length) {
      const coverId = (await drive.upload({ blob: b.cover, name: `${m.files[0].driveId}.jpg`, parentId: state.coversId, mimeType: 'image/jpeg' })).id
      await lib.silently(() => lib.putBook({ ...b, coverId }))
      m.coverId = coverId
    }
  }

  // 5. write the index if it changed
  if (!remote || !sameSnapshot(strip(remote), strip(merged))) {
    setStatus('syncing', 'Saving library…')
    const r = await drive.uploadJSON(merged, { name: 'library.json', parentId: state.rootId, fileId: state.libraryId ?? undefined })
    state.libraryId = r.id
  }
  await lib.silently(() => lib.setKV('tombstones', merged.deleted))

  // 6. move deleted books' files to Drive's trash
  const queue = (await lib.getKV('trashQueue')) ?? []
  for (const id of queue) await drive.trash(id)
  if (queue.length) await lib.setKV('trashQueue', [])

  // 7. fetch covers for cloud-only books
  await fetchCovers()
}

const strip = s => ({ books: s.books ?? {}, folders: s.folders ?? {}, deleted: s.deleted ?? {}, general: s.general ?? {} })

async function applyLocally(local, merged) {
  let touched = false
  await lib.silently(async () => {
    const localBooks = new Map((await lib.listBooks()).map(b => [b.id, b]))
    for (const [id, m] of Object.entries(merged.books)) {
      const cur = localBooks.get(id)
      if (!cur) {
        // new on another device: show it here, download on open
        await lib.putBook({ ...m, local: false, cover: null, openedAt: m.addedAt || Date.now(), needsMeta: false })
        touched = true
      } else if (!sameSnapshot(pickSyncFields(cur), m)) {
        await lib.putBook({ ...cur, ...m })
        touched = true
      }
    }
    for (const id of Object.keys(local.books)) if (!merged.books[id]) { await lib.dropBook(id); touched = true }

    for (const [id, f] of Object.entries(merged.folders)) {
      const cur = local.folders[id]
      if (!cur || !sameSnapshot(cur, f)) {
        const existing = (await lib.listFolders()).find(x => x.id === id)
        await lib.putFolder({ createdAt: f.at, ...existing, ...f })
        touched = true
      }
    }
    for (const id of Object.keys(local.folders)) if (!merged.folders[id]) { await lib.dropFolder(id); touched = true }

    if ((merged.general?.at || 0) > (local.general?.at || 0)) {
      await lib.setKV('notes.general', merged.general)
      touched = true
    }
  })
  if (touched) dispatchEvent(new CustomEvent('library-synced'))
}

async function fetchCovers() {
  const missing = (await lib.listBooks()).filter(b => !b.cover && b.coverId)
  if (!missing.length) return
  for (const b of missing) {
    try {
      const cover = await drive.download(b.coverId)
      await lib.silently(() => lib.touchBook(b.id, { cover }))
    } catch { /* cover is optional */ }
  }
  dispatchEvent(new CustomEvent('library-synced'))
}

// ---------------- downloading a cloud-only book ----------------
/** Make sure a book's files are on this device. onProgress: 0..1 */
export async function ensureLocal(id, onProgress) {
  const book = await lib.getBook(id)
  if (!book) throw new Error('Book not found')
  if (book.local !== false) return
  if (!book.files?.length) throw new Error('This book has not finished uploading from your other device yet')
  if (!drive.hasToken()) throw new realDrive.NeedAuthError()
  const total = book.files.reduce((n, f) => n + (f.size || 0), 0) || 1
  let done = 0
  const files = []
  for (const f of book.files) {
    const blob = await drive.download(f.driveId, p => onProgress?.((done + p * (f.size || 0)) / total))
    done += f.size || 0
    files.push(new File([blob], f.name, { type: f.type || blob.type }))
  }
  await lib.putFiles(id, files)
  await lib.silently(() => lib.touchBook(id, { local: true }))
}
