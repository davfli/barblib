// Library screen: folders, breadcrumbs, grid/list view, drag & drop, import.
import * as lib from './library.js'
import { detect, getHandler } from './formats/index.js'
import { el } from './util.js'
import { icon, toast, promptDialog, confirmDialog, pickFolderDialog, showMenu } from './ui.js'
import * as sync from './cloud/sync.js'
import * as drive from './cloud/drive.js'

const $ = s => document.querySelector(s)
const DRAG_TYPE = 'application/x-reader-item'

let openBook = () => {}
let folderId = null      // folder being shown (null = Library root)
let query = ''
let view = (() => { try { return localStorage.getItem('reader.view') || 'grid' } catch { return 'grid' } })()
let coverUrls = []
let data = { books: [], folders: [] }

export const currentFolder = () => folderId

// ---------------- import ----------------

/**
 * entries: [{ file, dir }] where dir is a relative folder path like "Sci-Fi/Asimov" ('' = here).
 * Creates matching folders under `baseFolder`. Images in the same folder become one set.
 * Returns ids of books that were added or already existed.
 */
export async function importEntries(entries, { baseFolder = folderId, openSingle = true } = {}) {
  entries = entries.filter(e => e.file.size > 0)
  if (!entries.length) return []
  const folders = await lib.listFolders()
  const folderCache = new Map()
  const ensureFolder = async dir => {
    if (!dir) return baseFolder
    if (folderCache.has(dir)) return folderCache.get(dir)
    const parts = dir.split('/')
    const parent = await ensureFolder(parts.slice(0, -1).join('/'))
    const name = parts.at(-1)
    let f = folders.find(x => (x.parentId ?? null) === (parent ?? null) && x.name === name)
    if (!f) { f = await lib.addFolder(name, parent); folders.push(f) }
    folderCache.set(dir, f.id)
    return f.id
  }

  const detected = await Promise.all(entries.map(async e => ({ ...e, handler: await detect(e.file) })))
  const skipped = detected.filter(d => !d.handler)
  const groups = []
  const imageGroups = new Map()
  for (const d of detected) {
    if (!d.handler) continue
    if (d.handler.id === 'image') imageGroups.set(d.dir, [...(imageGroups.get(d.dir) ?? []), d.file])
    else groups.push({ files: [d.file], handler: d.handler, dir: d.dir })
  }
  for (const [dir, files] of imageGroups) groups.push({ files, handler: getHandler('image'), dir })

  const ids = []
  let added = 0
  for (const g of groups) {
    const id = lib.bookId(g.files)
    const target = await ensureFolder(g.dir)
    const multi = g.files.length > 1
    const [, isNew] = await lib.addBook({
      id,
      handler: g.handler.id,
      fmt: multi ? 'images' : g.handler.formatLabel?.(g.files[0]) ?? g.handler.label,
      title: multi ? (g.dir.split('/').at(-1) || `${g.files[0].name} + ${g.files.length - 1}`)
        : g.files[0].name.replace(/\.[^.]+$/, ''),
      author: multi ? `${g.files.length} images` : '',
      cover: null,
      size: g.files.reduce((n, f) => n + f.size, 0),
      folderId: target,
      needsMeta: true,
    }, g.files)
    if (isNew) added++
    ids.push(id)
  }

  const skippedMsg = skipped.length
    ? `skipped ${skipped.length} unsupported file${skipped.length > 1 ? 's' : ''}` : ''
  const isFolderImport = entries.some(e => e.dir)
  if (openSingle && groups.length === 1 && !isFolderImport) {
    if (skippedMsg) toast(skippedMsg[0].toUpperCase() + skippedMsg.slice(1))
    await openBook(ids[0])
  } else {
    const parts = []
    if (groups.length) parts.push(`Imported ${added} new item${added === 1 ? '' : 's'}`
      + (groups.length - added ? ` (${groups.length - added} already in library)` : ''))
    if (skippedMsg) parts.push(parts.length ? skippedMsg : skippedMsg[0].toUpperCase() + skippedMsg.slice(1))
    if (parts.length) toast(parts.join(', '), 4500)
    await renderShelf()
  }
  return ids
}

export const importFiles = (files, opts) =>
  importEntries([...files].map(file => ({ file, dir: '' })), opts)

/** From <input webkitdirectory>: keep the folder structure (including the top folder). */
export const importDirectoryInput = files =>
  importEntries([...files].map(file => ({
    file, dir: (file.webkitRelativePath || '').split('/').slice(0, -1).join('/'),
  })))

/** From a drag & drop of files and/or folders. Must be called synchronously in the drop handler. */
export function importDataTransfer(dt, opts) {
  const roots = [...dt.items].filter(i => i.kind === 'file').map(i => i.webkitGetAsEntry?.()).filter(Boolean)
  const plainFiles = [...dt.files]
  return (async () => {
    if (!roots.length) return importFiles(plainFiles, opts)
    const out = []
    const readAll = reader => new Promise((res, rej) => {
      const acc = []
      const next = () => reader.readEntries(batch => batch.length ? (acc.push(...batch), next()) : res(acc), rej)
      next()
    })
    const walk = async (entry, dir) => {
      if (entry.isFile) out.push({ file: await new Promise((res, rej) => entry.file(res, rej)), dir })
      else for (const child of await readAll(entry.createReader()))
        await walk(child, dir ? `${dir}/${entry.name}` : entry.name)
    }
    for (const r of roots) await walk(r, '')
    return importEntries(out, opts)
  })()
}

// ---------------- actions ----------------
async function newFolder() {
  const name = await promptDialog({ title: 'New folder', placeholder: 'Folder name', okLabel: 'Create' })
  if (!name) return
  await lib.addFolder(name, folderId)
  renderShelf()
}

async function moveItem(kind, id) {
  const folders = await lib.listFolders()
  const item = kind === 'book' ? data.books.find(b => b.id === id) : folders.find(f => f.id === id)
  const dest = await pickFolderDialog({
    title: `Move "${item.title ?? item.name}" to…`,
    folders,
    current: kind === 'book' ? item.folderId ?? null : item.parentId ?? null,
    exclude: fid => kind === 'folder' && lib.isInside(folders, fid, id),
  })
  if (dest === undefined) return
  await moveTo(kind, id, dest)
}

async function moveTo(kind, id, dest) {
  try {
    if (kind === 'book') await lib.moveBook(id, dest)
    else if (id !== dest) await lib.moveFolder(id, dest)
    renderShelf()
  } catch (e) { toast(e.message) }
}

async function removeBook(b) {
  const inCloud = !!b.files?.length
  const ok = await confirmDialog({
    title: `${inCloud ? 'Delete' : 'Remove'} "${b.title}"?`,
    message: inCloud
      ? 'It is removed from barbLib on all your devices, with its bookmarks and notes. The cloud copy goes to your Google Drive trash (recoverable for 30 days).'
      : 'It is removed from this app, with its bookmarks and notes. The original file on your device is not touched.',
    okLabel: inCloud ? 'Delete everywhere' : 'Remove', danger: true,
  })
  if (!ok) return
  await lib.removeBook(b.id)
  renderShelf()
}

async function deleteFolder(f) {
  const ok = await confirmDialog({
    title: `Delete folder "${f.name}"?`,
    message: 'Everything inside it moves up one level. No books are removed.',
    okLabel: 'Delete folder', danger: true,
  })
  if (!ok) return
  await lib.deleteFolder(f.id)
  renderShelf()
}

async function renameFolder(f) {
  const name = await promptDialog({ title: 'Rename folder', value: f.name })
  if (!name) return
  await lib.renameFolder(f.id, name)
  renderShelf()
}

async function downloadBook(b) {
  try {
    if (!drive.hasToken()) await sync.reconnect()
    await sync.ensureLocal(b.id, p => toast(`Downloading ${b.title}… ${Math.round(p * 100)}%`, 60_000))
    toast(`${b.title} is now available offline`)
    renderShelf()
  } catch (e) { toast(`Download failed: ${e.message}`) }
}

async function removeDownload(b) {
  await lib.removeDownload(b.id)
  toast('Removed from this device. It stays in your cloud library.')
  renderShelf()
}

const bookMenu = b => [
  { label: 'Open', icon: 'open', onclick: () => openBook(b.id) },
  { label: 'Move to…', icon: 'move', onclick: () => moveItem('book', b.id) },
  ...(b.local === false
    ? [{ label: 'Download to this device', icon: 'download', onclick: () => downloadBook(b) }]
    : b.files?.length ? [{ label: 'Remove download (keep in cloud)', icon: 'cloudOff', onclick: () => removeDownload(b) }] : []),
  { label: b.files?.length ? 'Delete everywhere' : 'Remove', icon: 'trash', danger: true, onclick: () => removeBook(b) },
]
const folderMenu = f => [
  { label: 'Open', icon: 'folder', onclick: () => enter(f.id) },
  { label: 'Rename', icon: 'edit', onclick: () => renameFolder(f) },
  { label: 'Move to…', icon: 'move', onclick: () => moveItem('folder', f.id) },
  { label: 'Delete folder', icon: 'trash', danger: true, onclick: () => deleteFolder(f) },
]

function enter(id) {
  folderId = id
  query = ''
  $('#lib-search').value = ''
  renderShelf()
  $('.library-main').scrollTop = 0
}

// ---------------- drag & drop between folders ----------------
function makeDraggable(node, kind, id) {
  node.draggable = true
  node.addEventListener('dragstart', e => {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify({ kind, id }))
    e.dataTransfer.effectAllowed = 'move'
    node.classList.add('dragging')
  })
  node.addEventListener('dragend', () => node.classList.remove('dragging'))
}

function makeDropTarget(node, targetFolderId) {
  const ok = e => e.dataTransfer.types.includes(DRAG_TYPE)
  node.addEventListener('dragover', e => { if (ok(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; node.classList.add('drop-hover') } })
  node.addEventListener('dragleave', () => node.classList.remove('drop-hover'))
  node.addEventListener('drop', e => {
    node.classList.remove('drop-hover')
    if (!ok(e)) return
    e.preventDefault()
    e.stopPropagation()
    const { kind, id } = JSON.parse(e.dataTransfer.getData(DRAG_TYPE))
    if (kind === 'folder' && id === targetFolderId) return
    moveTo(kind, id, targetFolderId)
  })
}

// ---------------- rendering ----------------
const hue = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360
const fmtSize = n => n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`

function coverEl(b, small = false) {
  let node
  if (b.cover) {
    const url = URL.createObjectURL(b.cover)
    coverUrls.push(url)
    node = el('div', { class: 'cover' }, el('img', { src: url, alt: '', loading: 'lazy', draggable: 'false' }))
  } else {
    const h = hue(b.title || b.id)
    node = el('div', { class: 'cover placeholder', style: `--ph1:hsl(${h} 32% 42%);--ph2:hsl(${(h + 30) % 360} 38% 22%)` },
      small ? null : el('div', { class: 'ph-title' }, b.title), el('div'))
  }
  if (!small) node.append(el('span', { class: 'fmt' }, b.fmt))
  if (b.local === false) node.append(el('span', { class: 'cloud-badge', title: 'In the cloud: downloads when you open it' }, icon('cloud')))
  return node
}

function folderPath(id) {
  const byId = new Map(data.folders.map(f => [f.id, f]))
  const path = []
  for (let cur = byId.get(id); cur; cur = byId.get(cur.parentId)) path.unshift(cur)
  return path
}

function countInside(fid) {
  const sub = data.folders.filter(f => f.parentId === fid).length
  const books = data.books.filter(b => b.folderId === fid).length
  const n = sub + books
  return n === 0 ? 'Empty' : `${n} item${n === 1 ? '' : 's'}`
}

function folderTile(f) {
  const isList = view === 'list'
  const node = el('li', { class: `item folder-item${isList ? ' row' : ''}`, tabindex: '0', title: f.name,
    onclick: () => enter(f.id),
    onkeydown: e => { if (e.key === 'Enter') enter(f.id) },
    oncontextmenu: e => { e.preventDefault(); showMenu(folderMenu(f), { x: e.clientX, y: e.clientY }) } },
  isList
    ? [el('div', { class: 'row-icon folder-icon' }, icon('folder')),
       el('div', { class: 'row-main' }, el('div', { class: 'row-name' }, f.name), el('div', { class: 'row-sub' }, countInside(f.id))),
       el('div', { class: 'row-fmt' }, 'Folder'), el('div', { class: 'row-size' }), el('div', { class: 'row-prog' })]
    : [el('div', { class: 'folder-art' }, icon('folder')),
       el('div', { class: 'book-meta' }, el('div', { class: 'book-name' }, f.name), el('div', { class: 'book-author' }, countInside(f.id)))],
  el('button', { class: 'more', title: 'More', 'aria-label': `More actions for ${f.name}`,
    onclick: e => { e.stopPropagation(); showMenu(folderMenu(f), e.currentTarget) } }, icon('more')))
  makeDraggable(node, 'folder', f.id)
  makeDropTarget(node, f.id)
  return node
}

function bookTile(b, showPath) {
  const isList = view === 'list'
  const pct = Math.round((b.progress || 0) * 100)
  const where = showPath ? folderPath(b.folderId).map(f => f.name).join(' › ') || 'Library' : null
  const node = el('li', { class: `item book${isList ? ' row' : ''}`, tabindex: '0', title: b.title,
    onclick: () => openBook(b.id),
    onkeydown: e => { if (e.key === 'Enter') openBook(b.id) },
    oncontextmenu: e => { e.preventDefault(); showMenu(bookMenu(b), { x: e.clientX, y: e.clientY }) } },
  isList
    ? [el('div', { class: 'row-icon' }, coverEl(b, true)),
       el('div', { class: 'row-main' }, el('div', { class: 'row-name' }, b.title),
         el('div', { class: 'row-sub' }, [b.author, where].filter(Boolean).join(' · '))),
       el('div', { class: 'row-fmt' }, b.fmt), el('div', { class: 'row-size' }, fmtSize(b.size || 0)),
       el('div', { class: 'row-prog' }, pct ? `${pct}%` : '')]
    : [coverEl(b),
       el('div', { class: 'book-meta' },
         el('div', { class: 'book-name' }, b.title),
         b.author || where ? el('div', { class: 'book-author' }, [b.author, where].filter(Boolean).join(' · ')) : null,
         el('div', { class: 'book-progress' }, el('div', { style: `width:${pct}%` })))],
  el('button', { class: 'more', title: 'More', 'aria-label': `More actions for ${b.title}`,
    onclick: e => { e.stopPropagation(); showMenu(bookMenu(b), e.currentTarget) } }, icon('more')))
  makeDraggable(node, 'book', b.id)
  return node
}

function renderCrumbs() {
  const crumbs = $('#crumbs')
  const path = folderPath(folderId)
  const crumb = (id, name, last) => {
    const b = el('button', { class: `crumb${last ? ' current' : ''}`, onclick: () => enter(id) }, name)
    makeDropTarget(b, id)
    return b
  }
  crumbs.replaceChildren(
    crumb(null, 'Library', !path.length),
    ...path.flatMap((f, i) => [el('span', { class: 'sep' }, '›'), crumb(f.id, f.name, i === path.length - 1)]))
  crumbs.hidden = !path.length && !data.folders.length && !query
}

export async function renderShelf() {
  const [books, folders] = await Promise.all([lib.listBooks(), lib.listFolders()])
  data = { books, folders }
  if (folderId && !folders.some(f => f.id === folderId)) folderId = null
  coverUrls.forEach(u => URL.revokeObjectURL(u))
  coverUrls = []

  const shelf = $('#shelf')
  shelf.className = `shelf ${view}`
  for (const b of document.querySelectorAll('#view-toggle button')) b.classList.toggle('on', b.dataset.view === view)

  let items
  if (query) {
    const q = query.toLowerCase()
    const hitsF = folders.filter(f => f.name.toLowerCase().includes(q))
    const hitsB = books.filter(b => `${b.title} ${b.author}`.toLowerCase().includes(q))
    items = [...hitsF.map(folderTile), ...hitsB.map(b => bookTile(b, true))]
    $('#shelf-status').textContent = items.length ? `${items.length} result${items.length === 1 ? '' : 's'} for “${query}”` : `Nothing matches “${query}”`
  } else {
    const subFolders = folders.filter(f => (f.parentId ?? null) === folderId).sort((a, b) => a.name.localeCompare(b.name))
    const here = books.filter(b => (b.folderId ?? null) === folderId)
    items = [...subFolders.map(folderTile), ...here.map(b => bookTile(b, false))]
    $('#shelf-status').textContent = !items.length && folderId ? 'This folder is empty. Drag books here or import into it.' : ''
  }
  shelf.replaceChildren(...items)
  if (view === 'list' && items.length) shelf.prepend(el('li', { class: 'row head', 'aria-hidden': 'true' },
    el('div', { class: 'row-icon' }), el('div', { class: 'row-main' }, 'Name'), el('div', { class: 'row-fmt' }, 'Type'),
    el('div', { class: 'row-size' }, 'Size'), el('div', { class: 'row-prog' }, 'Read'), el('div', { class: 'more-spacer' })))
  $('#empty').hidden = books.length > 0 || folders.length > 0
  renderCrumbs()
}

// ---------------- setup ----------------
export function initShelf({ onOpenBook }) {
  openBook = onOpenBook
  addEventListener('library-synced', () => { if (!$('#library').hidden) renderShelf() })
  const fileInput = $('#file-input')
  const dirInput = $('#dir-input')
  fileInput.onchange = () => { importFiles(fileInput.files).catch(e => toast(e.message)); fileInput.value = '' }
  dirInput.onchange = () => { importDirectoryInput(dirInput.files).catch(e => toast(e.message)); dirInput.value = '' }

  const importMenu = anchor => showMenu([
    { label: 'Import files…', icon: 'upload', onclick: () => fileInput.click() },
    { label: 'Import a folder…', icon: 'folder', onclick: () => dirInput.click() },
    { label: 'New folder', icon: 'folderPlus', onclick: newFolder },
  ], anchor)
  $('#open-btn').onclick = e => importMenu(e.currentTarget)
  document.querySelector('[data-action=open]').onclick = () => fileInput.click()
  document.querySelector('[data-action=open-dir]').onclick = () => dirInput.click()
  $('#new-folder-btn').onclick = newFolder

  $('#view-toggle').addEventListener('click', e => {
    const b = e.target.closest('button')
    if (!b) return
    view = b.dataset.view
    try { localStorage.setItem('reader.view', view) } catch { /* ignore */ }
    renderShelf()
  })

  let t
  $('#lib-search').addEventListener('input', e => {
    clearTimeout(t)
    t = setTimeout(() => { query = e.target.value.trim(); renderShelf() }, 150)
  })
}
