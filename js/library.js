// Library storage in IndexedDB. Book files are stored locally (never uploaded)
// so the shelf works offline and on phones where files can't be re-opened by path.
//   books: { id, title, author, fmt, handler, cover, progress, position, addedAt, openedAt, size }
//   files: { id, files: File[] }

const DB_NAME = 'reader'
let dbp

function db() {
  dbp ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      const d = req.result
      d.createObjectStore('books', { keyPath: 'id' })
      d.createObjectStore('files', { keyPath: 'id' })
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

export async function addBook(meta, files) {
  const existing = await getBook(meta.id)
  if (existing) return existing
  const book = { progress: 0, position: null, addedAt: Date.now(), openedAt: Date.now(), ...meta }
  await tx(['books', 'files'], 'readwrite', (b, f) => {
    b.put(book)
    f.put({ id: meta.id, files: [...files] })
  })
  return book
}

export async function updateBook(id, patch) {
  return tx('books', 'readwrite', s => {
    const req = s.get(id)
    req.onsuccess = () => { if (req.result) s.put({ ...req.result, ...patch }) }
  })
}

export const removeBook = id =>
  tx(['books', 'files'], 'readwrite', (b, f) => { b.delete(id); f.delete(id) })

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
