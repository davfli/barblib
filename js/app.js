import { handlers, allExtensions } from './formats/index.js'
import * as S from './settings.js'
import * as shelf from './shelf.js'
import * as reader from './reader.js'
import * as notes from './notes.js'
import { toast, confirmDialog } from './ui.js'
import * as sync from './cloud/sync.js'
import * as drive from './cloud/drive.js'
import { VERSION } from './version.js'

const $ = s => document.querySelector(s)

// ---------------- settings panel ----------------
function syncPanel() {
  const s = S.effective()
  const caps = reader.session()?.capabilities ?? []
  for (const row of document.querySelectorAll('#settings-panel [data-needs]'))
    row.hidden = !caps.includes(row.dataset.needs)
  $('#text-section').hidden = !['fontSize', 'typography', 'flow', 'fit'].some(c => caps.includes(c))
  for (const seg of document.querySelectorAll('#settings-panel .seg[data-setting]'))
    for (const b of seg.children) b.classList.toggle('on', String(s[seg.dataset.setting]) === b.dataset.value)
  $('#font-size-val').textContent = `${s.fontSize}%`
  $('#warmth').value = s.warmth
  $('#warmth-val').textContent = s.warmth ? `${s.warmth}%` : 'Off'
  $('#dim').value = s.dim
  $('#dim-val').textContent = s.dim ? `${s.dim}%` : 'Off'
  $('#line-height').value = s.lineHeight
  $('#line-height-val').textContent = s.lineHeight.toFixed(1)
  $('#justify').checked = s.justify
  $('#wake-lock').checked = s.wakeLock
  $('#wake-row').hidden = !S.wakeLockSupported
  $('#sched-on').checked = s.schedule.on
  $('#sched-from').value = s.schedule.from
  $('#sched-to').value = s.schedule.to
  $('#sched-times').classList.toggle('disabled', !s.schedule.on)
  $('#profile-name').textContent = s.mode === 'bedtime' ? 'Bedtime' : 'Day'
  for (const b of document.querySelectorAll('[data-action=mode]')) {
    b.classList.toggle('on', s.mode === 'bedtime')
    b.title = s.mode === 'bedtime' ? 'Bedtime mode is on. Switch to day' : 'Switch to bedtime mode'
  }
}

function bindPanel() {
  const panel = $('#settings-panel')
  panel.addEventListener('click', e => {
    const b = e.target.closest('.seg[data-setting] button')
    if (!b) return
    const key = b.parentElement.dataset.setting
    const v = b.dataset.value
    if (key === 'mode') { if (S.settings.mode !== v) S.toggleMode() }
    else S.set(key, v)
  })
  for (const b of panel.querySelectorAll('[data-step]'))
    b.onclick = () => S.set('fontSize', Math.max(60, Math.min(250, S.settings.fontSize + Number(b.dataset.step))))
  $('#warmth').oninput = e => S.set('warmth', Number(e.target.value))
  $('#dim').oninput = e => S.set('dim', Number(e.target.value))
  $('#line-height').oninput = e => S.set('lineHeight', Number(e.target.value))
  $('#justify').onchange = e => S.set('justify', e.target.checked)
  $('#wake-lock').onchange = e => S.set('wakeLock', e.target.checked)
  $('#sched-on').onchange = e => { S.set('schedule.on', e.target.checked); S.resetSchedule() }
  $('#sched-from').onchange = e => { S.set('schedule.from', e.target.value); S.resetSchedule() }
  $('#sched-to').onchange = e => { S.set('schedule.to', e.target.value); S.resetSchedule() }
  $('#fullscreen-btn').onclick = toggleFullscreen
  $('#fullscreen-btn').hidden = !document.fullscreenEnabled
  panel.addEventListener('keydown', e => e.stopPropagation())

  for (const b of document.querySelectorAll('[data-action=settings]')) b.onclick = () => { syncPanel(); reader.togglePanel('#settings-panel') }
  for (const b of document.querySelectorAll('[data-action=mode]')) b.onclick = () => {
    S.toggleMode()
    toast(S.settings.mode === 'bedtime' ? 'Bedtime mode: warm, dim, low contrast' : 'Day mode', 1800)
  }
  for (const b of document.querySelectorAll('[data-action=notes]')) b.onclick = () => notes.toggleNotes()

  S.onChange(syncPanel)
  document.addEventListener('reader-session', syncPanel)
}

// ---------------- cloud ----------------
const ago = t => {
  if (!t) return 'never'
  const s = Math.round((Date.now() - t) / 1000)
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : new Date(t).toLocaleString()
}

function renderCloud(status = sync.getStatus(), state = sync.getState()) {
  const configured = drive.isConfigured()
  const connected = !!state?.connected
  const chip = $('#cloud-chip')
  chip.dataset.phase = status.phase
  const titles = {
    off: 'Cloud sync is off. Open settings to connect Google Drive',
    idle: `Synced with ${state?.email || 'Google Drive'} · ${ago(state?.lastSync)}`,
    syncing: status.detail || 'Syncing…',
    auth: 'Google sign-in expired. Tap to reconnect',
    offline: status.detail,
    error: `Sync problem: ${status.detail}. Tap to retry`,
  }
  chip.title = titles[status.phase] ?? ''

  $('#cloud-setup').hidden = configured
  $('#cloud-connect').hidden = !configured || connected
  $('#cloud-sync').hidden = !connected
  $('#cloud-disconnect').hidden = !connected
  $('#cloud-status').textContent = !configured
    ? 'Not set up yet. barbLib needs a Google client ID once.'
    : !connected ? 'Keep your books, positions, bookmarks and notes in your own Google Drive, and read on any device.'
    : `${titles[status.phase]}`
}

function bindCloud() {
  sync.onStatus(renderCloud)
  setInterval(() => renderCloud(), 30_000)
  const run = p => p.catch(e => toast(e.message, 5000))
  $('#cloud-chip').onclick = () => {
    const { phase } = sync.getStatus()
    if (phase === 'off') { syncPanel(); reader.togglePanel('#settings-panel'); $('#cloud-section').scrollIntoView({ block: 'nearest' }) }
    else if (phase === 'auth') run(sync.reconnect())
    else run(sync.syncNow())
  }
  $('#cloud-connect').onclick = () => run(sync.connect().then(() => toast('Connected. Your library is syncing.')))
  $('#cloud-sync').onclick = () => run(drive.hasToken() ? sync.syncNow() : sync.reconnect())
  $('#cloud-disconnect').onclick = async () => {
    const ok = await confirmDialog({ title: 'Disconnect Google Drive?',
      message: 'This device stops syncing. Nothing is deleted, neither here nor in your Drive.', okLabel: 'Disconnect' })
    if (ok) { await sync.disconnect(); renderCloud() }
  }
  $('#client-id-save').onclick = () => {
    const v = $('#client-id').value.trim()
    if (!/\.apps\.googleusercontent\.com$/.test(v)) { toast('That does not look like a Google client ID'); return }
    try { localStorage.setItem('barblib.clientId', v) } catch { /* ignore */ }
    drive.preload()
    renderCloud()
    toast('Saved. Now tap Connect Google Drive.')
  }
}

// ---------------- updates ----------------
let offered = null
async function checkForUpdate({ manual = false } = {}) {
  try {
    const res = await fetch(`version.json?t=${Date.now()}`, { cache: 'no-store' })
    const { version } = await res.json()
    if (version && version !== VERSION) {
      if (offered === version && !manual) return
      offered = version
      $('#update-version').textContent = version
      $('#update-bar').hidden = false
    } else if (manual) toast(`barbLib ${VERSION} is the latest version`)
  } catch { if (manual) toast("Couldn't check for updates (offline?)") }
}

async function applyUpdate() {
  $('#update-bar').hidden = true
  if (reader.isOpen()) reader.closeReader()          // saves your position first
  const reg = await navigator.serviceWorker?.getRegistration()
  await reg?.update().catch(() => {})
  location.reload()
}

function bindUpdates() {
  $('#app-version').textContent = VERSION
  $('#check-update').onclick = () => checkForUpdate({ manual: true })
  $('#update-now').onclick = applyUpdate
  $('#update-later').onclick = () => { $('#update-bar').hidden = true }
  setTimeout(checkForUpdate, 5000)
  setInterval(checkForUpdate, 20 * 60_000)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkForUpdate() })
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen()
  else document.documentElement.requestFullscreen?.().catch(() => {})
}

// ---------------- global keys & drops ----------------
function bindGlobal() {
  document.addEventListener('keydown', e => {
    if (e.target.matches?.('input, textarea, select, [contenteditable]')) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    if (e.key === 'n') { notes.toggleNotes(); e.preventDefault() }
    else if (e.key === 'f') { toggleFullscreen(); e.preventDefault() }
    else if (e.key === 'Escape' && !reader.isOpen()) reader.closePanels()
  })

  // drag files/folders from the desktop onto the window (not internal moves)
  let depth = 0
  const overlay = $('#drop-overlay')
  const isExternal = e => e.dataTransfer?.types.includes('Files')
  addEventListener('dragenter', e => { if (isExternal(e)) { depth++; overlay.classList.add('show') } })
  addEventListener('dragleave', e => { if (isExternal(e) && --depth <= 0) { depth = 0; overlay.classList.remove('show') } })
  addEventListener('dragover', e => { if (isExternal(e)) e.preventDefault() })
  addEventListener('drop', e => {
    if (!isExternal(e)) return
    e.preventDefault(); depth = 0; overlay.classList.remove('show')
    shelf.importDataTransfer(e.dataTransfer, { baseFolder: shelf.currentFolder() }).catch(err => toast(err.message))
  })
}

// ---------------- startup ----------------
async function start() {
  // after a reload we always start on the library, so drop a stale "reader" history marker
  if (history.state?.screen) history.replaceState(null, '')
  S.init()
  notes.initNotes()
  shelf.initShelf({ onOpenBook: id => reader.openBook(id) })
  reader.initReader({ onClose: () => shelf.renderShelf() })
  bindPanel()
  bindGlobal()
  bindCloud()
  bindUpdates()
  syncPanel()
  await sync.init()
  renderCloud()

  $('#format-list').textContent = 'Supported: ' + allExtensions()
    .filter(x => !['fb2.zip', 'prc', 'fbz', 'jpeg', 'ndjson', 'geojson'].includes(x))
    .map(x => x.toUpperCase()).join(', ')
  await shelf.renderShelf()

  // Installed app on Windows: "Open with → Reader" from Explorer
  if ('launchQueue' in window) {
    launchQueue.setConsumer(async params => {
      if (!params.files?.length) return
      shelf.importFiles(await Promise.all(params.files.map(h => h.getFile()))).catch(e => toast(e.message))
    })
  }

  // ?open=samples/book.epub opens a same-origin URL (handy for testing / links)
  const url = new URLSearchParams(location.search).get('open')
  if (url) {
    try {
      const u = new URL(url, location.href)
      if (u.origin !== location.origin) throw new Error('Only files from this site can be opened by link')
      const res = await fetch(u)
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
      const blob = await res.blob()
      history.replaceState(null, '', location.pathname)
      await shelf.importFiles([new File([blob], decodeURIComponent(u.pathname.split('/').pop()), { type: blob.type })])
    } catch (e) { toast(`Couldn't open link: ${e.message}`) }
  }

  navigator.storage?.persist?.().catch(() => {})
  if ('serviceWorker' in navigator && location.protocol !== 'file:')
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW registration failed', e))
}

globalThis.readerApp = { handlers, settings: S.settings, shelf, reader, sync, version: VERSION }
start()
