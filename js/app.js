import { handlers, detect, getHandler, allExtensions } from './formats/index.js'
import * as lib from './library.js'
import { el } from './util.js'

const $ = s => document.querySelector(s)

// ---------------- settings ----------------
const DEFAULTS = { theme: 'light', fontSize: 100, flow: 'paginated', fit: 'contain' }
const settings = (() => {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('reader.settings') || '{}') } }
  catch { return { ...DEFAULTS } }
})()
if (!localStorage.getItem('reader.settings') && matchMedia('(prefers-color-scheme: dark)').matches)
  settings.theme = 'dark'

function saveSettings() {
  try { localStorage.setItem('reader.settings', JSON.stringify(settings)) } catch { /* private mode */ }
}
function applyTheme() {
  document.documentElement.dataset.theme = settings.theme
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
  document.querySelector('meta[name=theme-color]').content = bg
}

// ---------------- toast ----------------
let toastTimer
function toast(msg, ms = 3200) {
  const t = $('#toast')
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('show'), ms)
}

// ---------------- library screen ----------------
const hue = s => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 360

async function renderShelf() {
  const books = await lib.listBooks()
  const shelf = $('#shelf')
  $('#empty').hidden = books.length > 0
  shelf.replaceChildren(...books.map(b => {
    const h = hue(b.title || b.id)
    const cover = b.cover
      ? el('div', { class: 'cover' }, el('img', { src: URL.createObjectURL(b.cover), alt: '', loading: 'lazy' }))
      : el('div', { class: 'cover placeholder', style: `--ph1:hsl(${h} 32% 42%);--ph2:hsl(${(h + 30) % 360} 38% 22%)` },
        el('div', { class: 'ph-title' }, b.title), el('div'))
    cover.append(el('span', { class: 'fmt' }, b.fmt))
    return el('li', { class: 'book', tabindex: '0', title: b.title,
      onclick: () => openBook(b.id),
      onkeydown: e => { if (e.key === 'Enter') openBook(b.id) } },
      cover,
      el('button', { class: 'remove', title: 'Remove from library', 'aria-label': `Remove ${b.title}`,
        onclick: async e => {
          e.stopPropagation()
          if (!confirm(`Remove "${b.title}" from your library?\nThe original file on your device is not touched.`)) return
          await lib.removeBook(b.id)
          renderShelf()
        } },
        svg('M6 6l12 12M18 6L6 18')),
      el('div', { class: 'book-meta' },
        el('div', { class: 'book-name' }, b.title),
        b.author ? el('div', { class: 'book-author' }, b.author) : null,
        el('div', { class: 'book-progress' }, el('div', { style: `width:${Math.round((b.progress || 0) * 100)}%` }))))
  }))
}

function svg(d) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.innerHTML = `<path d="${d}"/>`
  return s
}

// ---------------- opening files ----------------
async function openFiles(fileList) {
  const files = [...fileList].filter(f => f.size > 0)
  if (!files.length) return
  const detected = await Promise.all(files.map(async f => [f, await detect(f)]))
  const unsupported = detected.filter(([, h]) => !h).map(([f]) => f.name)
  if (unsupported.length) toast(`Can't open: ${unsupported.join(', ')}`)

  // several images picked together → one paged "book"
  const images = detected.filter(([, h]) => h?.id === 'image').map(([f]) => f)
  const groups = detected.filter(([, h]) => h && h.id !== 'image').map(([f, h]) => [[f], h])
  if (images.length) groups.push([images, getHandler('image')])

  let lastId
  for (const [group, handler] of groups) {
    const id = lib.bookId(group)
    await lib.addBook({
      id,
      handler: handler.id,
      fmt: group.length > 1 ? 'images' : handler.formatLabel?.(group[0]) ?? handler.label,
      title: group.length > 1 ? `${group[0].name} + ${group.length - 1}` : group[0].name.replace(/\.[^.]+$/, ''),
      author: '',
      cover: null,
      size: group.reduce((n, f) => n + f.size, 0),
      needsMeta: true,
    }, group)
    lastId = id
  }
  if (groups.length > 1) { toast(`Added ${groups.length} items to your library`); renderShelf() }
  if (groups.length === 1) await openBook(lastId)
}

// ---------------- reader screen ----------------
let current = null // { id, session, handler, saveTimer }

async function openBook(id) {
  const book = await lib.getBook(id)
  const files = await lib.getFiles(id)
  if (!book || !files) { toast('That book is no longer in the library'); renderShelf(); return }
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

  const state = { id, handler, session: null, saveTimer: null, fraction: book.progress || 0 }
  current = state
  try {
    const session = await handler.open(files, {
      container: stage,
      settings: { ...settings },
      position: book.position,
      onRelocate: info => onRelocate(state, info),
    })
    if (current !== state) { session.destroy(); return } // user navigated away meanwhile
    state.session = session
    stage.querySelector(':scope > .loading')?.remove()
    $('#book-title').textContent = session.title
    document.title = session.title
    buildToc(session)
    updateSettingsPanel()
    // first open: store real title/author/cover from the file's metadata
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

function onRelocate(state, { fraction, label, chapter, position }) {
  if (current !== state) return
  state.fraction = fraction
  $('#progress').value = fraction
  $('#progress-label').textContent = label
  $('#book-sub').textContent = chapter || state.session?.author || ''
  highlightToc()
  clearTimeout(state.saveTimer)
  state.saveTimer = setTimeout(() => lib.updateBook(state.id, { position, progress: fraction }), 400)
}

function closeReader({ silent = false } = {}) {
  if (!current) return
  const { session, saveTimer } = current
  clearTimeout(saveTimer)
  try { session?.destroy() } catch (e) { console.warn(e) }
  current = null
  closePanels()
  $('#reader').classList.remove('immersive')
  $('#stage').replaceChildren()
  $('#stage').className = 'stage'
  document.title = 'Reader'
  if (!silent) { showScreen('library'); renderShelf() }
}

function showScreen(name) {
  $('#library').hidden = name !== 'library'
  $('#reader').hidden = name !== 'reader'
}

// ---------------- TOC ----------------
function buildToc(session) {
  $('#toc-btn').disabled = !session.toc
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
  $('#toc').replaceChildren(session.toc ? build(session.toc) : el('div', { class: 'empty-toc' }, 'No table of contents'))
}

function highlightToc() {
  const href = current?.session?.currentHref?.()
  for (const b of document.querySelectorAll('#toc button.current')) b.classList.remove('current')
  if (href === null || href === undefined) return
  const btn = document.querySelector(`#toc button[data-href="${CSS.escape(String(href))}"]`)
  btn?.classList.add('current')
}

// ---------------- panels ----------------
function closePanels() {
  $('#toc-panel').classList.remove('show')
  $('#settings-panel').classList.remove('show')
  $('#scrim').classList.remove('show')
}
function togglePanel(id) {
  const p = $(id), open = !p.classList.contains('show')
  closePanels()
  if (open) {
    p.classList.add('show')
    $('#scrim').classList.add('show')
    if (id === '#toc-panel') $('#toc button.current')?.scrollIntoView({ block: 'center' })
  }
}

function updateSettingsPanel() {
  const caps = current?.session?.capabilities ?? []
  for (const row of document.querySelectorAll('#settings-panel [data-needs]'))
    row.hidden = !caps.includes(row.dataset.needs)
  for (const seg of document.querySelectorAll('#settings-panel .seg'))
    for (const b of seg.children) b.classList.toggle('on', settings[seg.dataset.setting] === b.dataset.value)
  $('#font-size-val').textContent = `${settings.fontSize}%`
}

function changeSetting(key, value) {
  settings[key] = value
  saveSettings()
  if (key === 'theme') applyTheme()
  current?.session?.applySettings({ ...settings })
  updateSettingsPanel()
}

// ---------------- events ----------------
function bind() {
  const input = $('#file-input')
  const pick = () => input.click()
  $('#open-btn').onclick = pick
  document.querySelector('[data-action=open]').onclick = pick
  input.onchange = () => { openFiles(input.files).catch(e => toast(e.message)); input.value = '' }

  $('#theme-quick').onclick = () => {
    const order = ['light', 'sepia', 'dark']
    changeSetting('theme', order[(order.indexOf(settings.theme) + 1) % order.length])
  }

  $('#back-btn').onclick = () => history.state?.screen === 'reader' ? history.back() : closeReader()
  window.addEventListener('popstate', () => { if (current) closeReader() })

  $('#toc-btn').onclick = () => togglePanel('#toc-panel')
  $('#settings-btn').onclick = () => togglePanel('#settings-panel')
  $('#scrim').onclick = closePanels
  $('#prev-btn').onclick = () => current?.session?.prev()
  $('#next-btn').onclick = () => current?.session?.next()

  const slider = $('#progress')
  slider.oninput = () => { $('#progress-label').textContent = `${Math.round(slider.value * 100)}%` }
  slider.onchange = () => current?.session?.goToFraction(parseFloat(slider.value))

  for (const seg of document.querySelectorAll('#settings-panel .seg'))
    seg.addEventListener('click', e => {
      const b = e.target.closest('button')
      if (b) changeSetting(seg.dataset.setting, b.dataset.value)
    })
  for (const b of document.querySelectorAll('#settings-panel [data-step]'))
    b.onclick = () => changeSetting('fontSize',
      Math.max(60, Math.min(250, settings.fontSize + Number(b.dataset.step))))

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

  document.addEventListener('keydown', e => {
    if (!current?.session) return
    if (e.target.matches?.('input[type=search], input[type=text], textarea')) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    switch (e.key) {
      case 'ArrowLeft': case 'PageUp': current.session.prev(); break
      case 'ArrowRight': case 'PageDown': case ' ': current.session.next(); break
      case 'Escape':
        if (document.querySelector('.drawer.show, .popover.show')) closePanels()
        else $('#back-btn').click()
        break
      case 't': togglePanel('#toc-panel'); break
      default: return
    }
    e.preventDefault()
  })

  // drag & drop anywhere
  let depth = 0
  const overlay = $('#drop-overlay')
  addEventListener('dragenter', e => { if (e.dataTransfer?.types.includes('Files')) { depth++; overlay.classList.add('show') } })
  addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; overlay.classList.remove('show') } })
  addEventListener('dragover', e => e.preventDefault())
  addEventListener('drop', e => {
    e.preventDefault(); depth = 0; overlay.classList.remove('show')
    if (e.dataTransfer?.files.length) openFiles(e.dataTransfer.files).catch(err => toast(err.message))
  })
}

// ---------------- startup ----------------
async function start() {
  // after a reload we always start on the library, so drop a stale "reader" history marker
  if (history.state?.screen) history.replaceState(null, '')
  applyTheme()
  bind()
  $('#format-list').textContent = 'Supported: ' + allExtensions()
    .filter(x => !['fb2.zip', 'prc', 'fbz', 'jpeg', 'ndjson', 'geojson'].includes(x))
    .map(x => x.toUpperCase()).join(', ')
  await renderShelf()

  // Installed app on Windows: "Open with → Reader" from Explorer
  if ('launchQueue' in window) {
    launchQueue.setConsumer(async params => {
      if (!params.files?.length) return
      openFiles(await Promise.all(params.files.map(h => h.getFile()))).catch(e => toast(e.message))
    })
  }

  // ?open=samples/book.epub — open a same-origin URL (handy for testing / links)
  const url = new URLSearchParams(location.search).get('open')
  if (url) {
    try {
      const u = new URL(url, location.href)
      if (u.origin !== location.origin) throw new Error('Only files from this site can be opened by link')
      const res = await fetch(u)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const blob = await res.blob()
      history.replaceState(null, '', location.pathname)
      await openFiles([new File([blob], decodeURIComponent(u.pathname.split('/').pop()), { type: blob.type })])
    } catch (e) { toast(`Couldn't open link: ${e.message}`) }
  }

  // ask the browser not to evict the library when storage gets tight
  navigator.storage?.persist?.().catch(() => {})

  if ('serviceWorker' in navigator && location.protocol !== 'file:')
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e))
}

// expose for debugging in devtools
globalThis.readerApp = { openFiles, openBook, handlers, settings }
start()
