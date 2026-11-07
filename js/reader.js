// Reader screen: opens a book with its format handler, navigation, contents,
// bookmarks, progress saving.
import { getHandler } from './formats/index.js'
import * as lib from './library.js'
import * as S from './settings.js'
import * as notes from './notes.js'
import { el } from './util.js'
import { icon, toast } from './ui.js'

const $ = s => document.querySelector(s)

let current = null // { id, handler, session, saveTimer, info, bookmarks }
let onClosed = () => {}

export const isOpen = () => !!current?.session
export const session = () => current?.session

// ---------------- open / close ----------------
export async function openBook(id) {
  const book = await lib.getBook(id)
  const files = await lib.getFiles(id)
  if (!book || !files) { toast('That book is no longer in the library'); onClosed(); return }
  const handler = getHandler(book.handler)

  if (current) closeReader({ silent: true })
  showScreen('reader')
  if (history.state?.screen !== 'reader') history.pushState({ screen: 'reader' }, '')

  const stage = $('#stage')
  stage.replaceChildren(el('div', { class: 'loading' }, 'Opening…'))
  $('#book-title').textContent = book.title
  $('#book-sub').textContent = ''
  $('#progress-label').textContent = ''
  $('#progress').value = book.progress || 0

  const state = { id, handler, session: null, saveTimer: null, info: null, bookmarks: book.bookmarks ?? [] }
  current = state
  try {
    const session = await handler.open(files, {
      container: stage,
      settings: S.effective(),
      position: book.position,
      onRelocate: info => onRelocate(state, info),
    })
    if (current !== state) { session.destroy(); return } // navigated away meanwhile
    state.session = session
    stage.querySelector(':scope > .loading')?.remove()
    $('#book-title').textContent = session.title
    document.title = session.title
    buildToc(session)
    renderBookmarks()
    updateBookmarkButton()
    document.dispatchEvent(new CustomEvent('reader-session'))
    S.setReading(true)
    notes.setBook({
      id, title: session.title,
      getContext: () => ({
        label: state.info?.label, chapter: state.info?.chapter,
        selection: session.getSelectionText?.() ?? '',
      }),
    })
    if (book.needsMeta) {
      const cover = await lib.makeThumbnail(session.cover)
      await lib.updateBook(id, { title: session.title, author: session.author || '', cover, needsMeta: false })
    }
    await lib.updateBook(id, { openedAt: Date.now() })
  } catch (err) {
    console.error(err)
    toast(`Couldn't open this file: ${err.message || err}`, 5000)
    closeReader()
  }
}

export function closeReader({ silent = false } = {}) {
  if (!current) return
  const { session, saveTimer, id, info } = current
  clearTimeout(saveTimer)
  if (info) lib.updateBook(id, { position: info.position, progress: info.fraction })
  try { session?.destroy() } catch (e) { console.warn(e) }
  current = null
  S.setReading(false)
  notes.setBook(null)
  closePanels()
  $('#reader').classList.remove('immersive')
  $('#stage').replaceChildren()
  $('#stage').className = 'stage'
  document.title = 'Reader'
  if (!silent) { showScreen('library'); onClosed() }
}

function showScreen(name) {
  $('#library').hidden = name !== 'library'
  $('#reader').hidden = name !== 'reader'
}

function onRelocate(state, info) {
  if (current !== state) return
  state.info = info
  $('#progress').value = info.fraction
  $('#progress-label').textContent = info.label
  $('#book-sub').textContent = info.chapter || state.session?.author || ''
  highlightToc()
  updateBookmarkButton()
  clearTimeout(state.saveTimer)
  state.saveTimer = setTimeout(() =>
    lib.updateBook(state.id, { position: info.position, progress: info.fraction }), 400)
}

// ---------------- bookmarks ----------------
const currentBookmark = () => {
  const { session, info, bookmarks } = current ?? {}
  if (!session || !info) return null
  return bookmarks.find(b => session.samePosition?.(b.position, info.position)) ?? null
}

function updateBookmarkButton() {
  const on = !!currentBookmark()
  const btn = $('#bookmark-btn')
  btn.classList.toggle('on', on)
  btn.title = on ? 'Remove bookmark (B)' : 'Bookmark this page (B)'
  btn.setAttribute('aria-pressed', on)
}

export async function toggleBookmark() {
  if (!current?.info) return
  const existing = currentBookmark()
  if (existing) {
    current.bookmarks = current.bookmarks.filter(b => b.id !== existing.id)
    toast('Bookmark removed', 1500)
  } else {
    const { info } = current
    current.bookmarks = [...current.bookmarks, {
      id: lib.newId(), position: info.position, fraction: info.fraction,
      label: info.label, chapter: info.chapter || '', snippet: info.snippet || '', createdAt: Date.now(),
    }].sort((a, b) => a.fraction - b.fraction)
    toast('Bookmarked', 1500)
  }
  await lib.updateBook(current.id, { bookmarks: current.bookmarks })
  updateBookmarkButton()
  renderBookmarks()
}

async function deleteBookmark(id) {
  current.bookmarks = current.bookmarks.filter(b => b.id !== id)
  await lib.updateBook(current.id, { bookmarks: current.bookmarks })
  updateBookmarkButton()
  renderBookmarks()
}

const dateFmt = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

function renderBookmarks() {
  const list = $('#bookmarks')
  const bms = current?.bookmarks ?? []
  $('#tab-bookmarks .count').textContent = bms.length ? bms.length : ''
  if (!bms.length) {
    list.replaceChildren(el('div', { class: 'empty-toc' },
      'No bookmarks yet. Tap ', icon('bookmark'), ' in the top bar or press B to bookmark a page.'))
    return
  }
  list.replaceChildren(el('ul', {}, bms.map(b => el('li', { class: 'bm' },
    el('button', { class: 'bm-main', onclick: () => { current.session.goToPosition(b.position); closePanels() } },
      el('div', { class: 'bm-title' }, [b.chapter, b.label].filter(Boolean).join(' · ') || 'Bookmark'),
      b.snippet ? el('div', { class: 'bm-snippet' }, `${b.snippet}…`) : null,
      el('div', { class: 'bm-date' }, dateFmt.format(b.createdAt))),
    el('button', { class: 'icon-btn sm', title: 'Delete bookmark', 'aria-label': 'Delete bookmark',
      onclick: () => deleteBookmark(b.id) }, icon('close'))))))
}

// ---------------- contents ----------------
function buildToc(session) {
  $('#toc-title').textContent = session.title
  $('#toc-author').textContent = session.author || ''
  const img = $('#toc-cover')
  if (session.cover instanceof Blob && !/svg/.test(session.cover.type)) {
    img.src = URL.createObjectURL(session.cover); img.hidden = false
  } else img.hidden = true

  const build = items => el('ul', {}, items.map(item => el('li', {},
    el('button', { dataset: { href: String(item.href) }, onclick: () => {
      session.goTo(item.href); closePanels()
    } }, (item.label || '').trim() || '—'),
    item.subitems?.length ? build(item.subitems) : null)))
  $('#toc').replaceChildren(session.toc ? build(session.toc) : el('div', { class: 'empty-toc' }, 'This file has no table of contents.'))
  showTab(session.toc ? 'toc' : 'bookmarks')
}

function highlightToc() {
  const href = current?.session?.currentHref?.()
  for (const b of document.querySelectorAll('#toc button.current')) b.classList.remove('current')
  if (href === null || href === undefined) return
  document.querySelector(`#toc button[data-href="${CSS.escape(String(href))}"]`)?.classList.add('current')
}

function showTab(name) {
  for (const t of document.querySelectorAll('.drawer-tabs button')) t.classList.toggle('on', t.dataset.tab === name)
  $('#toc').hidden = name !== 'toc'
  $('#bookmarks').hidden = name !== 'bookmarks'
}

// ---------------- panels ----------------
export function closePanels() {
  $('#toc-panel').classList.remove('show')
  $('#settings-panel').classList.remove('show')
  $('#scrim').classList.remove('show')
}
export function togglePanel(id, tab) {
  const p = $(id), open = !p.classList.contains('show') || (tab && !$(`.drawer-tabs [data-tab=${tab}]`).classList.contains('on'))
  closePanels()
  if (!open) return
  if (tab) showTab(tab)
  p.classList.add('show')
  $('#scrim').classList.add('show')
  if (id === '#toc-panel') $('#toc button.current')?.scrollIntoView({ block: 'center' })
}

// ---------------- setup ----------------
export function initReader({ onClose }) {
  onClosed = onClose
  $('#back-btn').onclick = () => history.state?.screen === 'reader' ? history.back() : closeReader()
  window.addEventListener('popstate', () => { if (current) closeReader() })

  $('#toc-btn').onclick = () => togglePanel('#toc-panel')
  $('#bookmark-btn').onclick = toggleBookmark
  $('#scrim').onclick = closePanels
  $('#prev-btn').onclick = () => current?.session?.prev()
  $('#next-btn').onclick = () => current?.session?.next()
  for (const t of document.querySelectorAll('.drawer-tabs button')) t.onclick = () => showTab(t.dataset.tab)

  const slider = $('#progress')
  slider.oninput = () => { $('#progress-label').textContent = `${Math.round(slider.value * 100)}%` }
  slider.onchange = () => current?.session?.goToFraction(parseFloat(slider.value))

  // tap zones: left third = back, right third = forward, middle = hide/show bars
  const stage = $('#stage')
  const onTap = x => {
    const r = stage.getBoundingClientRect()
    const rel = (x - r.left) / r.width
    if (rel < 0.3) current?.session?.prev()
    else if (rel > 0.7) current?.session?.next()
    else $('#reader').classList.toggle('immersive')
  }
  stage.addEventListener('stage-tap', e => onTap(e.detail.x))
  stage.addEventListener('click', e => { if (e.target.closest('.img-view')) onTap(e.clientX) })
  stage.addEventListener('toast', e => toast(e.detail))

  S.onChange(s => current?.session?.applySettings(s))

  document.addEventListener('keydown', e => {
    if (!current?.session) return
    if (e.target.matches?.('input, textarea, select, [contenteditable]')) return
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
    switch (e.key) {
      case 'ArrowLeft': case 'PageUp': current.session.prev(); break
      case 'ArrowRight': case 'PageDown': case ' ': current.session.next(); break
      case 'Escape':
        if (document.querySelector('.drawer.show, .popover.show')) closePanels()
        else $('#back-btn').click()
        break
      case 't': togglePanel('#toc-panel', 'toc'); break
      case 'b': toggleBookmark(); break
      default: return
    }
    e.preventDefault()
  })
}
