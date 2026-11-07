// Small UI helpers: icons, toast, dialogs, popup menus, folder picker.
import { el } from './util.js'

export const ICONS = {
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  folderPlus: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM12 11v5M9.5 13.5h5',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  close: 'M6 6l12 12M18 6L6 18',
  bookmark: 'M7 4h10v16l-5-4-5 4z',
  notes: 'M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 17h5',
  moon: 'M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z',
  sun: 'M12 4V2M12 22v-2M4 12H2M22 12h-2M5.6 5.6 4.2 4.2M19.8 19.8l-1.4-1.4M5.6 18.4l-1.4 1.4M19.8 4.2l-1.4 1.4M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  move: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM10 13h6M13 10l3 3-3 3',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  open: 'M4 6c3-1 6-1 8 1 2-2 5-2 8-1v13c-3-1-6-1-8 1-2-2-5-2-8-1zM12 7v13',
  settings: 'M4 19h3M4 5h3M17 19h3M17 5h3M7 5l5 14 5-14M9 13h6',
  pin: 'M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11zM12 8v4',
  quote: 'M7 7h4v4c0 3-2 5-4 6M14 7h4v4c0 3-2 5-4 6',
  minus: 'M5 12h14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  expand: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
}

export function icon(name) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  s.setAttribute('viewBox', '0 0 24 24')
  s.setAttribute('aria-hidden', 'true')
  s.innerHTML = `<path d="${ICONS[name]}"/>`
  return s
}

// ---------------- toast ----------------
let toastTimer
export function toast(msg, ms = 3200) {
  const t = document.getElementById('toast')
  t.textContent = msg
  t.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => t.classList.remove('show'), ms)
}

// ---------------- dialogs ----------------
function dialog(build) {
  return new Promise(resolve => {
    const d = el('dialog', { class: 'dialog' })
    const done = v => { d.close(); d.remove(); resolve(v) }
    d.append(build(done))
    d.addEventListener('cancel', e => { e.preventDefault(); done(null) })
    d.addEventListener('click', e => { if (e.target === d) done(null) }) // backdrop
    document.body.append(d)
    d.showModal()
  })
}

export const promptDialog = ({ title, value = '', okLabel = 'Save', placeholder = '' }) => dialog(done => {
  const input = el('input', { type: 'text', value, placeholder, 'aria-label': title })
  const form = el('form', { method: 'dialog', onsubmit: e => { e.preventDefault(); done(input.value.trim() || null) } },
    el('h3', {}, title), input,
    el('div', { class: 'dialog-actions' },
      el('button', { type: 'button', class: 'btn', onclick: () => done(null) }, 'Cancel'),
      el('button', { type: 'submit', class: 'btn primary' }, okLabel)))
  setTimeout(() => { input.focus(); input.select() })
  return form
})

export const confirmDialog = ({ title, message = '', okLabel = 'OK', danger = false }) => dialog(done => {
  const ok = el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => done(true) }, okLabel)
  setTimeout(() => ok.focus())
  return el('div', {},
    el('h3', {}, title), message ? el('p', { class: 'muted' }, message) : null,
    el('div', { class: 'dialog-actions' },
      el('button', { class: 'btn', onclick: () => done(false) }, 'Cancel'), ok))
})

/** Pick a destination folder. Resolves to folderId, null (= Library root) or undefined (cancelled). */
export const pickFolderDialog = ({ title, folders, exclude = () => false, current = null }) => new Promise(resolve => {
  let chosen = current
  dialog(done => {
    const byParent = new Map()
    for (const f of [...folders].sort((a, b) => a.name.localeCompare(b.name)))
      byParent.set(f.parentId ?? null, [...(byParent.get(f.parentId ?? null) ?? []), f])
    const row = (id, name, depth) => {
      const disabled = id !== null && exclude(id)
      const b = el('button', {
        class: `pick-row${id === chosen ? ' on' : ''}`, style: `padding-left:${12 + depth * 18}px`,
        disabled, onclick: () => {
          chosen = id
          for (const x of list.querySelectorAll('.pick-row')) x.classList.toggle('on', x === b)
        },
        ondblclick: () => !disabled && done({ id }),
      }, icon('folder'), name)
      return b
    }
    const list = el('div', { class: 'pick-list' })
    const walk = (parentId, depth) => {
      for (const f of byParent.get(parentId) ?? []) {
        list.append(row(f.id, f.name, depth))
        if (!exclude(f.id)) walk(f.id, depth + 1)
      }
    }
    list.append(row(null, 'Library', 0))
    walk(null, 1)
    return el('div', {},
      el('h3', {}, title), list,
      el('div', { class: 'dialog-actions' },
        el('button', { class: 'btn', onclick: () => done(null) }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: () => done({ id: chosen }) }, 'Move here')))
  }).then(v => resolve(v ? v.id : undefined))
})

// ---------------- popup menu ----------------
let openMenu = null
export function closeMenu() { openMenu?.remove(); openMenu = null }

/** items: [{ label, icon, onclick, danger }] ; at: {x, y} or an anchor element */
export function showMenu(items, at) {
  closeMenu()
  const menu = el('div', { class: 'menu', role: 'menu' },
    items.map(it => el('button', {
      role: 'menuitem', class: it.danger ? 'danger' : '',
      onclick: e => { e.stopPropagation(); closeMenu(); it.onclick() },
    }, it.icon ? icon(it.icon) : null, it.label)))
  document.body.append(menu)
  let x, y
  if (at instanceof Element) { const r = at.getBoundingClientRect(); x = r.right; y = r.bottom + 4 }
  else ({ x, y } = at)
  const mr = menu.getBoundingClientRect()
  menu.style.left = `${Math.max(8, Math.min(x - (at instanceof Element ? mr.width : 0), innerWidth - mr.width - 8))}px`
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - mr.height - 8))}px`
  menu.querySelector('button')?.focus()
  openMenu = menu
}
addEventListener('pointerdown', e => { if (openMenu && !openMenu.contains(e.target)) closeMenu() }, true)
addEventListener('keydown', e => { if (e.key === 'Escape' && openMenu) { closeMenu(); e.stopPropagation() } }, true)
addEventListener('resize', closeMenu)
