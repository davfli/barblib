// Library storage in IndexedDB. Book files are stored locally (never uploaded)
// so the shelf works offline and on phones where files can't be re-opened by path.
//   books:   { id, title, author, fmt, handler, cover, progress, position, folderId,
//              bookmarks: [{ id, position, fraction, label, chapter, snippet, createdAt }],
//              notes: string, addedAt, openedAt, size }
//   files:   { id, files: File[] }
//   folders: { id, name, parentId, createdAt }
//   kv:      free-form values (general notes etc.)

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
  if (existing) return [existing, false]
  const book = {
    progress: 0, position: null, folderId: null, bookmarks: [], notes: '',
    addedAt: Date.now(), openedAt: Date.now(), ...meta,
  }
  await tx(['books', 'files'], 'readwrite', (b, f) => {
    b.put(book)
    f.put({ id: meta.id, files: [...files] })
  })
  return [book, true]
}

export const updateBook = (id, changes) => patch('books', id, b => ({ ...b, ...changes }))
export const updateBookWith = (id, fn) => patch('books', id, b => ({ ...b, ...fn(b) }))
export const moveBook = (id, folderId) => updateBook(id, { folderId: folderId ?? null })

export const removeBook = id =>
  tx(['books', 'files'], 'readwrite', (b, f) => { b.delete(id); f.delete(id) })

// ---------- folders ----------
export const listFolders = () => tx('folders', 'readonly', s => s.getAll())

export async function addFolder(name, parentId = null) {
  const folder = { id: uid(), name: name.trim() || 'New folder', parentId, createdAt: Date.now() }
  await tx('folders', 'readwrite', s => s.put(folder))
  return folder
}

export const renameFolder = (id, name) => patch('folders', id, f => ({ ...f, name: name.trim() || f.name }))

/** true if `id` is `ancestorId` or lies somewhere inside it */
export function isInside(folders, id, ancestorId) {
  const byId = new Map(folders.map(f => [f.id, f]))
  for (let cur = id; cur; cur = byId.get(cur)?.parentId) if (cur === ancestorId) return true
  return false
}

export async function moveFolder(id, parentId) {
  const folders = await listFolders()
  if (parentId && isInside(folders, parentId, id)) throw new Error("A folder can't go inside itself")
  return patch('folders', id, f => ({ ...f, parentId: parentId ?? null }))
}

/** Deletes a folder; its books and sub-folders move up to the parent. */
export async function deleteFolder(id) {
  const [folders, books] = await Promise.all([listFolders(), listBooks()])
  const folder = folders.find(f => f.id === id)
  if (!folder) return
  await tx(['folders', 'books'], 'readwrite', (fs, bs) => {
    for (const f of folders) if (f.parentId === id) fs.put({ ...f, parentId: folder.parentId })
    for (const b of books) if (b.folderId === id) bs.put({ ...b, folderId: folder.parentId })
    fs.delete(id)
  })
}

// ---------- key/value ----------
export const getKV = key => tx('kv', 'readonly', s => s.get(key))
export const setKV = (key, value) => tx('kv', 'readwrite', s => s.put(value, key))

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

export const newId = uid
