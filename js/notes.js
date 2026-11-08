// Floating notes window: drag it anywhere by its title bar, resize from the
// corner, collapse to just the bar. Two notebooks: "This book" (saved with the
// book) and "General" (always available, also from the library).
import * as lib from './library.js'
import { el } from './util.js'
import { icon, toast } from './ui.js'

const UI_KEY = 'reader.notesUI'
let ui = { open: false, collapsed: false, x: null, y: null, w: 340, h: 300, tab: 'book' }
try { ui = { ...ui, ...JSON.parse(localStorage.getItem(UI_KEY) || '{}') } } catch { /* ignore */ }
const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)) } catch { /* ignore */ } }

let panel, textarea, tabBook, tabGeneral, status, bookActions
let book = null          // { id, title, getContext(): { label, chapter, selection } }
let loadedKey = null     // which notebook the textarea shows: 'general' | book id
let saveTimer = null

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
  const head = el('div', { class: 'notes-head' },
    el('span', { class: 'notes-grip', 'aria-hidden': 'true' }, icon('notes')),
    tabBook, tabGeneral, el('div', { class: 'spacer' }),
    el('button', { class: 'icon-btn sm', title: 'Collapse', 'aria-label': 'Collapse notes', onclick: toggleCollapse }, icon('minus')),
    el('button', { class: 'icon-btn sm', title: 'Close (N)', 'aria-label': 'Close notes', onclick: () => setOpen(false) }, icon('close')))
  panel = el('section', { class: 'notes', 'aria-label': 'Notes', hidden: true },
    head,
    el('div', { class: 'notes-body' }, textarea, el('div', { class: 'notes-foot' }, bookActions, status)))
  document.body.append(panel)

  textarea.addEventListener('input', () => {
    status.textContent = 'Editing…'
    clearTimeout(saveTimer)
    saveTimer = setTimeout(save, 500)
  })
  textarea.addEventListener('keydown', e => e.stopPropagation()) // no page turns while typing
  textarea.addEventListener('blur', () => { if (saveTimer) { clearTimeout(saveTimer); save() } })

  enableDrag(head)
  new ResizeObserver(() => {
    if (panel.hidden || ui.collapsed || innerWidth < 600) return
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
  if (!panel || panel.hidden) return
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
    if (e.target.closest('button') || innerWidth < 600) return
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

// ---------------- which notebook ----------------
/** Called by the reader when a book opens (ctx) or closes (null). */
export async function setBook(ctx) {
  if (saveTimer) { clearTimeout(saveTimer); await save() }
  book = ctx
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

function insertLocation() {
  if (!book) return
  insertAtCursor(`📍 ${where() || 'here'}`)
}

function insertQuote() {
  const sel = book?.getContext?.().selection?.trim()
  if (!sel) { toast('Select some text in the book first'); return }
  insertAtCursor(`> ${sel.replace(/\s+/g, ' ')}\n  — ${where()}`)
}
