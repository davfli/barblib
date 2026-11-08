// Library storage in IndexedDB. Book files are stored locally (never uploaded
// unless cloud sync is connected) so the shelf works offline.
//
//   books:   { id, title, author, fmt, handler, cover, size, addedAt, openedAt, folderId,
//              position, progress, bookmarks: [...], notes,
//              local: bool            // files present on this device
//              files: [{ driveId, name, size, type }] | null   // cloud copies
//              coverId,                                        // cloud cover thumbnail
//              metaAt, positionAt, bookmarksAt, notesAt }      // change times (for sync)
//   files:   { id, files: File[] }
//   folders: { id, name, parentId, createdAt, at }
//   kv:      notes.general { text, at }, tombstones { 'book:id' | 'folder:id': time },
//            cloud state, pending trash …
//
// Every change dispatches a 'library-change' event so the sync engine can react.

const DB_NAME = 'reader'
let dbp

function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2)
    req.onupgradeneeded = () => {
      const d = req.result
      const make = (name, opts) => { if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, opts) }
      make('books', { keyPath: 'id' })
      make('files', { keyPath: 'id' })
      make('folders', { keyPath: 'id' })
      make('kv')
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbp
}

async function tx(stores, mode, fn) {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode)
    const result = fn(...[stores].flat().map(s => t.objectStore(s)))
    t.oncomplete = () => resolve(result instanceof IDBRequest ? result.result : result)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error ?? new Error('Transaction aborted'))
  })
}

// read-modify-write of one record inside a single transaction
const patch = (store, id, fn) => tx(store, 'readwrite', s => {
  const req = s.get(id)
  req.onsuccess = () => { if (req.result) s.put(fn(req.result)) }
})

const uid = () => crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
export const newId = uid

let quiet = 0 // >0 while the sync engine writes (its own writes shouldn't trigger a sync)
const changed = what => { if (!quiet) dispatchEvent(new CustomEvent('library-change', { detail: what })) }
export async function silently(fn) { quiet++; try { return await fn() } finally { quiet-- } }

// which change-time a field belongs to
const STAMP = {
  title: 'metaAt', author: 'metaAt', folderId: 'metaAt', cover: 'metaAt',
  position: 'positionAt', progress: 'positionAt',
  bookmarks: 'bookmarksAt', notes: 'notesAt',
}
const stamp = (changes, now = Date.now()) => {
  const s = {}
  for (const k of Object.keys(changes)) if (STAMP[k]) s[STAMP[k]] = now
  return s
}

// ---------- books ----------
export const bookId = files => files.length === 1
  ? `${files[0].name}|${files[0].size}`
  : `set|${files.map(f => `${f.name}:${f.size}`).sort().join('|')}`

export async function listBooks() {
  const all = await tx('books', 'readonly', s => s.getAll())
  return all.sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))
}

export const getBook = id => tx('books', 'readonly', s => s.get(id))

export async function getFiles(id) {
  const rec = await tx('files', 'readonly', s => s.get(id))
  return rec?.files ?? null
}

/** Adds a book; returns [book, isNew]. Existing books are left where they are. */
export async function addBook(meta, files) {
  const existing = await getBook(meta.id)
  if (existing && existing.local !== false) return [existing, false]
  const now = Date.now()
  const book = existing
    ? { ...existing, local: true } // was cloud-only: we now have the file, keep its state
    : {
        progress: 0, position: null, folderId: null, bookmarks: [], notes: '',
        addedAt: now, openedAt: now, local: true, files: null, coverId: null,
        metaAt: now, positionAt: 0, bookmarksAt: 0, notesAt: 0, ...meta,
      }
  await tx(['books', 'files'], 'readwrite', (b, f) => {
    b.put(book)
    f.put({ id: meta.id, files: [...files] })
  })
  await clearTombstone(`book:${meta.id}`)
  changed({ type: 'book', id: meta.id })
  return [book, !existing]
}

/** User-level change: stamps the right change-time so sync knows it's newer. */
export async function updateBook(id, changes) {
  await patch('books', id, b => ({ ...b, ...changes, ...stamp(changes) }))
  if (Object.keys(changes).some(k => STAMP[k])) changed({ type: 'book', id })
}
export const moveBook = (id, folderId) => updateBook(id, { folderId: folderId ?? null })

/** Local-only bookkeeping (openedAt, needsMeta …) that doesn't need syncing. */
export const touchBook = (id, changes) => patch('books', id, b => ({ ...b, ...changes }))

/** Raw write used by sync (keeps the given change-times). */
export const putBook = book => tx('books', 'readwrite', s => s.put(book))
export const putFiles = (id, files) => tx('files', 'readwrite', s => s.put({ id, files: [...files] }))

export async function removeBook(id) {
  const book = await getBook(id)
  await tx(['books', 'files'], 'readwrite', (b, f) => { b.delete(id); f.delete(id) })
  await addTombstone(`book:${id}`)
  if (book?.files?.length || book?.coverId) await queueTrash([...(book.files ?? []).map(f => f.driveId), book.coverId].filter(Boolean))
  changed({ type: 'book', id, deleted: true })
}

/** Frees space on this device; the cloud copy stays. */
export async function removeDownload(id) {
  await tx(['books', 'files'], 'readwrite', (b, f) => {
    const req = b.get(id)
    req.onsuccess = () => { if (req.result) b.put({ ...req.result, local: false }) }
    f.delete(id)
  })
}

/** Sync: delete a book that was removed on another device (no tombstone/trash). */
export const dropBook = id => tx(['books', 'files'], 'readwrite', (b, f) => { b.delete(id); f.delete(id) })

// ---------- folders ----------
export const listFolders = () => tx('folders', 'readonly', s => s.getAll())

export async function addFolder(name, parentId = null) {
  const now = Date.now()
  const folder = { id: uid(), name: name.trim() || 'New folder', parentId, createdAt: now, at: now }
  await tx('folders', 'readwrite', s => s.put(folder))
  changed({ type: 'folder', id: folder.id })
  return folder
}

export async function renameFolder(id, name) {
  await patch('folders', id, f => ({ ...f, name: name.trim() || f.name, at: Date.now() }))
  changed({ type: 'folder', id })
}

/** true if `id` is `ancestorId` or lies somewhere inside it */
export function isInside(folders, id, ancestorId) {
  const byId = new Map(folders.map(f => [f.id, f]))
  for (let cur = id; cur; cur = byId.get(cur)?.parentId) if (cur === ancestorId) return true
  return false
}

export async function moveFolder(id, parentId) {
  const folders = await listFolders()
  if (parentId && isInside(folders, parentId, id)) throw new Error("A folder can't go inside itself")
  await patch('folders', id, f => ({ ...f, parentId: parentId ?? null, at: Date.now() }))
  changed({ type: 'folder', id })
}

/** Deletes a folder; its books and sub-folders move up to the parent. */
export async function deleteFolder(id) {
  const [folders, books] = await Promise.all([listFolders(), listBooks()])
  const folder = folders.find(f => f.id === id)
  if (!folder) return
  const now = Date.now()
  await tx(['folders', 'books'], 'readwrite', (fs, bs) => {
    for (const f of folders) if (f.parentId === id) fs.put({ ...f, parentId: folder.parentId, at: now })
    for (const b of books) if (b.folderId === id) bs.put({ ...b, folderId: folder.parentId, metaAt: now })
    fs.delete(id)
  })
  await addTombstone(`folder:${id}`)
  changed({ type: 'folder', id, deleted: true })
}

export const putFolder = folder => tx('folders', 'readwrite', s => s.put(folder))
export const dropFolder = id => tx('folders', 'readwrite', s => s.delete(id))

// ---------- key/value ----------
export const getKV = key => tx('kv', 'readonly', s => s.get(key))
export const setKV = (key, value) => tx('kv', 'readwrite', s => s.put(value, key))

export async function getGeneralNotes() {
  const v = await getKV('notes.general')
  return typeof v === 'string' ? { text: v, at: 0 } : v ?? { text: '', at: 0 }
}
export async function setGeneralNotes(text) {
  await setKV('notes.general', { text, at: Date.now() })
  changed({ type: 'notes' })
}

// ---------- tombstones & cloud trash queue ----------
export const getTombstones = async () => (await getKV('tombstones')) ?? {}
async function addTombstone(key) {
  const t = await getTombstones()
  t[key] = Date.now()
  await setKV('tombstones', t)
}
async function clearTombstone(key) {
  const t = await getTombstones()
  if (key in t) { delete t[key]; await setKV('tombstones', t) }
}
async function queueTrash(ids) {
  const q = (await getKV('trashQueue')) ?? []
  await setKV('trashQueue', [...new Set([...q, ...ids])])
}

// ---------- helpers ----------
export async function makeThumbnail(blob, height = 360) {
  if (!blob) return null
  try {
    const bmp = await createImageBitmap(blob)
    const scale = Math.min(1, height / bmp.height)
    const c = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale))
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height)
    bmp.close?.()
    return await c.convertToBlob({ type: 'image/jpeg', quality: 0.82 })
  } catch {
    return null
  }
}
