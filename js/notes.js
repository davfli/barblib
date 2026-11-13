// Floating notes window: drag it anywhere by its title bar, resize from the
// corner, collapse to just the bar. Two notebooks: "This book" (saved with the
// book) and "General" (always available, also from the library).
import * as lib from './library.js'
import { el } from './util.js'
import { icon, toast, showMenu } from './ui.js'
import * as S from './settings.js'

const UI_KEY = 'reader.notesUI'
let ui = { open: false, collapsed: false, x: null, y: null, w: 340, h: 300, tab: 'book' }
try { ui = { ...ui, ...JSON.parse(localStorage.getItem(UI_KEY) || '{}') } } catch { /* ignore */ }
const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)) } catch { /* ignore */ } }

let panel, textarea, tabBook, tabGeneral, status, bookActions, linkBar
let book = null          // { id, title, getContext(): { label, chapter, selection } }
let loadedKey = null     // which notebook the textarea shows: 'general' | book id
let saveTimer = null
let ext = null           // { win, kind: 'pip' | 'window' } while notes live in their own window
let head, popBtn, dockBtn, collapseBtn

export function initNotes() {
  textarea = el('textarea', { class: 'notes-text', placeholder: 'Write anything…', spellcheck: 'true',
    'aria-label': 'Notes' })
  tabBook = el('button', { class: 'notes-tab', onclick: () => switchTab('book') }, 'This book')
  tabGeneral = el('button', { class: 'notes-tab', onclick: () => switchTab('general') }, 'General')
  status = el('span', { class: 'notes-status' })
  bookActions = el('div', { class: 'notes-actions' },
    el('button', { class: 'chip', title: 'Insert where you are in the book', onclick: insertLocation },
      icon('pin'), 'Location'),
    el('button', { class: 'chip', title: 'Insert the text you selected in the book', onclick: insertQuote },
      icon('quote'), 'Quote selection'))
  popBtn = el('button', { class: 'icon-btn sm hide-sm', title: 'Pop out of barbLib (also: right-click)', 'aria-label': 'Pop out notes',
    onclick: e => showMenu(popMenu(), e.currentTarget) }, icon('popout'))
  dockBtn = el('button', { class: 'icon-btn sm', title: 'Put back into barbLib', 'aria-label': 'Put notes back into barbLib',
    hidden: true, onclick: () => dock() }, icon('dock'))
  collapseBtn = el('button', { class: 'icon-btn sm', title: 'Collapse', 'aria-label': 'Collapse notes', onclick: toggleCollapse }, icon('minus'))
  head = el('div', { class: 'notes-head' },
    el('span', { class: 'notes-grip', 'aria-hidden': 'true' }, icon('notes')),
    tabBook, tabGeneral, el('div', { class: 'spacer' }),
    popBtn, dockBtn, collapseBtn,
    el('button', { class: 'icon-btn sm', title: 'Close (N)', 'aria-label': 'Close notes', onclick: () => setOpen(false) }, icon('close')))
  panel = el('section', { class: 'notes', 'aria-label': 'Notes', hidden: true },
    head,
    el('div', { class: 'notes-body' }, textarea,
      linkBar = el('div', { class: 'notes-links', hidden: true, 'aria-label': 'Jump to a place in the book' }),
      el('div', { class: 'notes-foot' }, bookActions, status)))
  document.body.append(panel)

  // Ctrl/Cmd+click on a 📍 line jumps to that place in the book
  textarea.addEventListener('click', e => {
    if (!(e.ctrlKey || e.metaKey) || textarea.selectionStart !== textarea.selectionEnd) return
    const v = textarea.value, i = textarea.selectionStart
    const line = v.slice(v.lastIndexOf('\n', i - 1) + 1, (v.indexOf('\n', i) + 1 || v.length + 1) - 1)
    const m = line.match(LINK_RE_ONE)
    if (m) { e.preventDefault(); jump(m[1]) }
  })
  textarea.addEventListener('input', () => {
    status.textContent = 'Editing…'
    renderLinks()
    clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 500)
  })
  textarea.addEventListener('keydown', e => e.stopPropagation()) // no page turns while typing
  textarea.addEventListener('blur', () => { if (saveTimer) { clearTimeout(saveTimer); save() } })

  enableDrag(head)
  // right-click anywhere on the notes window except the text: pop-out menu
  panel.addEventListener('contextmenu', e => {
    if (ext || e.target === textarea || innerWidth < 600) return
    e.preventDefault()
    showMenu(popMenu(), { x: e.clientX, y: e.clientY })
  })
  S.onChange(syncExternalTheme)
  addEventListener('pagehide', () => ext?.win.close())
  new ResizeObserver(() => {
    if (ext || panel.hidden || ui.collapsed || innerWidth < 600) return
    const r = panel.getBoundingClientRect()
    if (r.width && r.height) { ui.w = Math.round(r.width); ui.h = Math.round(r.height); saveUI() }
  }).observe(panel)
  addEventListener('resize', () => place())

  if (ui.open) setOpen(true)

  // another device changed notes: refresh unless you're typing
  addEventListener('library-synced', () => {
    if (!panel.hidden && !saveTimer && document.activeElement !== textarea) load()
  })
}

// ---------------- open / close / collapse ----------------
export function toggleNotes() { setOpen(panel.hidden) }

export function setOpen(open) {
  if (!open && ext) dock()
  ui.open = open
  saveUI()
  panel.hidden = !open
  document.querySelectorAll('[data-action=notes]').forEach(b => b.classList.toggle('on', open))
  if (open) {
    if (ui.collapsed) { ui.collapsed = false; saveUI() }
    applyCollapse()
    place()
    load().then(() => textarea.focus({ preventScroll: true }))
  } else if (saveTimer) { clearTimeout(saveTimer); save() }
}

function toggleCollapse() {
  ui.collapsed = !ui.collapsed
  saveUI()
  applyCollapse()
  place()
}
function applyCollapse() {
  panel.classList.toggle('collapsed', ui.collapsed)
  if (!ui.collapsed && innerWidth >= 600) { panel.style.width = `${ui.w}px`; panel.style.height = `${ui.h}px` }
  else if (ui.collapsed) { panel.style.height = '' }
}

// keep the panel on screen; default position = bottom right
function place() {
  if (!panel || panel.hidden || ext) return
  if (innerWidth < 600) { panel.style.left = ''; panel.style.top = ''; panel.classList.add('sheet'); return }
  panel.classList.remove('sheet')
  const r = panel.getBoundingClientRect()
  const x = ui.x ?? innerWidth - r.width - 16
  const y = ui.y ?? innerHeight - r.height - 76
  panel.style.left = `${Math.max(8, Math.min(x, innerWidth - r.width - 8))}px`
  panel.style.top = `${Math.max(8, Math.min(y, innerHeight - 48))}px`
}

function enableDrag(handle) {
  let start = null
  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button') || innerWidth < 600 || ext) return
    const r = panel.getBoundingClientRect()
    start = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    handle.setPointerCapture(e.pointerId)
    panel.classList.add('dragging')
  })
  handle.addEventListener('pointermove', e => {
    if (!start) return
    ui.x = e.clientX - start.dx
    ui.y = e.clientY - start.dy
    place()
  })
  const end = () => { if (start) { start = null; panel.classList.remove('dragging'); saveUI() } }
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)
  handle.addEventListener('dblclick', e => { if (!e.target.closest('button')) toggleCollapse() })
}

// ---------------- own window / always on top ----------------
const pipSupported = () => 'documentPictureInPicture' in window

function popMenu() {
  return [
    ...(pipSupported() ? [{ label: 'Float on top of everything', icon: 'pip', onclick: () => popOut('pip') }] : []),
    { label: 'Open in its own window (split screen)', icon: 'popout', onclick: () => popOut('window') },
    { label: ui.collapsed ? 'Expand' : 'Collapse', icon: 'minus', onclick: toggleCollapse },
    { label: 'Close notes', icon: 'close', onclick: () => setOpen(false) },
  ]
}

/**
 * Moves the notes into their own window. 'pip' = small window that stays on top
 * even when barbLib is minimised (Edge/Chrome desktop); 'window' = normal window
 * you can snap next to barbLib (Win + left/right). Typing, saving and "Quote
 * selection" keep working; closing that window puts the notes back.
 */
export async function popOut(kind) {
  if (ext) dock()
  const w = Math.max(320, ui.w), h = Math.max(260, ui.h)
  let win
  try {
    // open the window first: browsers only allow it right after a click
    if (kind === 'pip') win = await documentPictureInPicture.requestWindow({ width: w, height: h })
    else {
      win = window.open('', 'barblib-notes', `popup,width=${w + 20},height=${h + 40}`)
      if (!win) { toast('The window was blocked. Allow pop-ups for barbLib and try again.'); return }
      win.document.open()
      win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>barbLib notes</title></head><body></body></html>')
      win.document.close()
    }
  } catch (e) { toast(`Couldn't pop out: ${e.message}`); return }

  if (panel.hidden) setOpen(true)
  if (ui.collapsed) { ui.collapsed = false; saveUI(); applyCollapse() }
  const d = win.document
  for (const link of document.querySelectorAll('link[rel=stylesheet]'))
    d.head.append(Object.assign(d.createElement('link'), { rel: 'stylesheet', href: link.href }))
  d.head.append(Object.assign(d.createElement('meta'), { name: 'color-scheme', content: 'light dark' }))
  d.body.classList.add('notes-window')
  ext = { win, kind }
  syncExternalTheme()
  d.title = book ? `Notes - ${book.title}` : 'barbLib notes'
  panel.classList.add('external')
  panel.classList.remove('sheet', 'dragging')
  d.body.append(panel)
  popBtn.hidden = true
  dockBtn.hidden = false
  collapseBtn.hidden = true
  win.addEventListener('pagehide', () => { if (ext?.win === win) dock() })
  textarea.focus({ preventScroll: true })
}

/** Puts the notes back into barbLib's window. */
export function dock() {
  if (!ext) return
  const { win } = ext
  ext = null
  if (saveTimer) { clearTimeout(saveTimer); save() }
  panel.classList.remove('external')
  document.body.append(panel)
  popBtn.hidden = false
  dockBtn.hidden = true
  collapseBtn.hidden = false
  applyCollapse()
  place()
  try { if (!win.closed) win.close() } catch { /* already gone */ }
}

function syncExternalTheme() {
  if (!ext) return
  const d = ext.win.document
  d.documentElement.dataset.theme = document.documentElement.dataset.theme
  d.documentElement.dataset.mode = document.documentElement.dataset.mode
}

// ---------------- which notebook ----------------
/** Called by the reader when a book opens (ctx) or closes (null). */
export async function setBook(ctx) {
  if (saveTimer) { clearTimeout(saveTimer); await save() }
  book = ctx
  if (ext) ext.win.document.title = book ? `Notes - ${book.title}` : 'barbLib notes'
  if (!panel.hidden) await load()
  else updateTabs()
}

function switchTab(tab) {
  if (tab === 'book' && !book) return
  if (saveTimer) { clearTimeout(saveTimer); save() }
  ui.tab = tab
  saveUI()
  load()
}

const activeKey = () => ui.tab === 'book' && book ? book.id : 'general'

function updateTabs() {
  const key = activeKey()
  tabBook.disabled = !book
  tabBook.title = book ? book.title : 'Open a book to keep notes with it'
  tabBook.classList.toggle('on', key !== 'general')
  tabGeneral.classList.toggle('on', key === 'general')
  bookActions.hidden = key === 'general'
  if (key === 'general') linkBar.hidden = true
  textarea.placeholder = key === 'general' ? 'General notes: anything, any time…' : `Notes for ${book.title}…`
}

async function load() {
  updateTabs()
  const key = activeKey()
  const text = key === 'general'
    ? (await lib.getGeneralNotes()).text
    : (await lib.getBook(key))?.notes ?? ''
  loadedKey = key
  textarea.value = text
  renderLinks()
  status.textContent = ''
}

async function save() {
  saveTimer = null
  const key = loadedKey
  if (!key) return
  try {
    if (key === 'general') await lib.setGeneralNotes(textarea.value)
    else await lib.updateBook(key, { notes: textarea.value })
    status.textContent = 'Saved'
  } catch (e) { status.textContent = 'Not saved!'; toast(`Couldn't save notes: ${e.message}`) }
}

// ---------------- links to places in the book ----------------
// A note marker looks like  📍[k3f9] Chapter 5 · 21%  - the code points to an
// exact position stored with the book (noteLinks), so it survives edits and syncs.
const LINK_RE = /📍\[([a-z0-9]{3,10})\]\s*([^\n]*)/g
const LINK_RE_ONE = /📍\[([a-z0-9]{3,10})\]/

async function createLink() {
  const c = book?.getContext?.() ?? {}
  if (!c.position) return null
  const id = Math.random().toString(36).slice(2, 6)
  const rec = await lib.getBook(book.id)
  await lib.updateBook(book.id, { noteLinks: { ...rec?.noteLinks, [id]: { position: c.position, label: where() } } })
  return id
}

async function jump(id) {
  if (!book?.goTo) return
  const link = (await lib.getBook(book.id))?.noteLinks?.[id]
  if (!link) { toast('That place is not known on this device yet'); return }
  await book.goTo(link.position)
  if (ext?.kind !== 'pip') toast(`Jumped to ${link.label || 'your note'}`, 1500)
}

function renderLinks() {
  if (!linkBar) return
  const onBook = loadedKey && loadedKey !== 'general' && book
  const found = onBook ? [...textarea.value.matchAll(LINK_RE)] : []
  linkBar.hidden = !found.length
  linkBar.replaceChildren(...found.map(([, id, label]) => el('button', {
    class: 'link-chip', title: 'Jump to this place', onclick: () => jump(id),
  }, icon('pin'), (label || 'Place').trim().slice(0, 40))))
}

// ---------------- inserting ----------------
function insertAtCursor(text) {
  const { selectionStart: s, selectionEnd: e, value } = textarea
  const before = value.slice(0, s)
  const pre = before && !before.endsWith('\n') ? '\n' : ''
  textarea.setRangeText(pre + text + '\n', s, e, 'end')
  textarea.dispatchEvent(new Event('input'))
  textarea.focus()
}

function where() {
  const c = book?.getContext?.() ?? {}
  return [c.chapter, c.label].filter(Boolean).join(' · ')
}

async function insertLocation() {
  if (!book) return
  const id = await createLink()
  insertAtCursor(id ? `📍[${id}] ${where() || 'here'}` : `📍 ${where() || 'here'}`)
}

async function insertQuote() {
  const sel = book?.getContext?.().selection?.trim()
  if (!sel) { toast('Select some text in the book first'); return }
  const id = await createLink()
  insertAtCursor(`> ${sel.replace(/\s+/g, ' ')}\n  — ${id ? `📍[${id}] ` : ''}${where()}`)
}
