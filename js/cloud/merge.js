// Pure merge of two library snapshots (this device vs. the cloud).
//
// Snapshot = {
//   books:   { [id]: book-without-blobs },
//   folders: { [id]: folder },
//   deleted: { 'book:id' | 'folder:id': time },
//   general: { text, at },
// }
//
// Rules (per book, each group independently; newest change wins):
//   meta      (title, author, folder, …)  ← metaAt
//   position  (position, progress)        ← positionAt
//   bookmarks                             ← bookmarksAt
//   notes                                 ← notesAt
//   cloud file ids: whichever side has them
// A deletion wins if it happened after the last change on the other side.

export const BOOK_GROUPS = {
  metaAt: ['title', 'author', 'fmt', 'handler', 'size', 'addedAt', 'folderId'],
  positionAt: ['position', 'progress'],
  bookmarksAt: ['bookmarks'],
  notesAt: ['notes', 'noteLinks'],
}
export const SYNC_FIELDS = ['id', 'files', 'coverId',
  ...Object.entries(BOOK_GROUPS).flatMap(([k, v]) => [k, ...v])]

const lastChange = b => b ? Math.max(b.metaAt || 0, b.positionAt || 0, b.bookmarksAt || 0, b.notesAt || 0, b.addedAt || 0) : 0

export function pickSyncFields(book) {
  const out = {}
  for (const k of SYNC_FIELDS) if (book[k] !== undefined) out[k] = book[k]
  return out
}

function mergeBook(a, b) {
  if (!a) return { ...b }
  if (!b) return { ...a }
  const out = { id: a.id }
  for (const [stamp, fields] of Object.entries(BOOK_GROUPS)) {
    const src = (b[stamp] || 0) > (a[stamp] || 0) ? b : a
    out[stamp] = src[stamp] || 0
    for (const f of fields) if (src[f] !== undefined) out[f] = src[f]
  }
  out.files = a.files?.length ? a.files : b.files ?? null
  out.coverId = a.coverId || b.coverId || null
  return out
}

function mergeMap(a = {}, b = {}, deleted, kind, merge, changeOf) {
  const out = {}
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const del = deleted[`${kind}:${id}`] || 0
    const m = merge(a[id], b[id])
    if (del && del >= changeOf(m)) continue
    out[id] = m
  }
  return out
}

export function merge(local, remote) {
  remote ??= {}
  const deleted = { ...remote.deleted }
  for (const [k, t] of Object.entries(local.deleted ?? {})) deleted[k] = Math.max(deleted[k] || 0, t)

  const books = mergeMap(local.books, remote.books, deleted, 'book', mergeBook, lastChange)
  const folders = mergeMap(local.folders, remote.folders, deleted, 'folder',
    (a, b) => !a ? { ...b } : !b ? { ...a } : (b.at || 0) > (a.at || 0) ? { ...b } : { ...a },
    f => f.at || f.createdAt || 0)

  // a deletion that lost (item changed later) is dropped so it can't win later
  for (const k of Object.keys(deleted)) {
    const [kind, id] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)]
    if ((kind === 'book' && books[id]) || (kind === 'folder' && folders[id])) delete deleted[k]
  }
  // books in a folder that no longer exists go to the top level
  for (const b of Object.values(books)) if (b.folderId && !folders[b.folderId]) b.folderId = null
  for (const f of Object.values(folders)) if (f.parentId && !folders[f.parentId]) f.parentId = null

  const lg = local.general ?? { text: '', at: 0 }, rg = remote.general ?? { text: '', at: 0 }
  const general = (rg.at || 0) > (lg.at || 0) ? rg : lg

  return { app: 'barbLib', format: 1, books, folders, deleted, general }
}

/** Stable comparison, ignoring key order. */
export const sameSnapshot = (a, b) => canonical(a) === canonical(b)
function canonical(x) {
  if (Array.isArray(x)) return `[${x.map(canonical).join(',')}]`
  if (x && typeof x === 'object') return `{${Object.keys(x).filter(k => x[k] !== undefined).sort()
    .map(k => `${JSON.stringify(k)}:${canonical(x[k])}`).join(',')}}`
  return JSON.stringify(x ?? null)
}
