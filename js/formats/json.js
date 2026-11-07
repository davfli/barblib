// Generic JSON viewer: collapsible tree, search, raw view. Also reads
// JSON Lines (.jsonl / .ndjson) as an array of records.
import { extOf, startsWith, el } from '../util.js'

const EXT = ['json', 'jsonl', 'ndjson', 'geojson']
const CHUNK = 300          // children rendered per "show more"
const MAX_RESULTS = 300    // search hits listed
const RAW_LIMIT = 3e6      // characters shown in raw mode

const typeOf = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v
const isContainer = v => v !== null && typeof v === 'object'
const entriesOf = v => Array.isArray(v) ? v.map((x, i) => [i, x]) : Object.entries(v)
const sizeOf = v => Array.isArray(v) ? v.length : Object.keys(v).length

const pathToString = path => '$' + path.map(k =>
  typeof k === 'number' ? `[${k}]` : /^[A-Za-z_$][\w$]*$/.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`).join('')

function parse(text, name) {
  text = text.replace(/^﻿/, '')
  try { return JSON.parse(text) }
  catch (err) {
    // JSON Lines fallback
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length > 1 || /\.(jsonl|ndjson)$/i.test(name)) {
      try { return lines.map(l => JSON.parse(l)) } catch { /* fall through */ }
    }
    throw err
  }
}

function primitive(v) {
  switch (typeOf(v)) {
    case 'string': return el('span', { class: 'jn-str' }, JSON.stringify(v))
    case 'number': return el('span', { class: 'jn-num' }, String(v))
    case 'boolean': return el('span', { class: 'jn-bool' }, String(v))
    default: return el('span', { class: 'jn-null' }, 'null')
  }
}

const summary = v => Array.isArray(v)
  ? `[ ${v.length} item${v.length === 1 ? '' : 's'} ]`
  : `{ ${sizeOf(v)} key${sizeOf(v) === 1 ? '' : 's'} }`

export default {
  id: 'json',
  label: 'JSON',
  extensions: EXT,

  detect(file, head) {
    const ext = extOf(file.name)
    if (EXT.includes(ext)) return true
    if (/json/.test(file.type)) return true
    if (ext) return false // has some other extension: let other handlers decide
    let i = startsWith(head, '\xEF\xBB\xBF') ? 3 : 0
    while (i < head.length && /\s/.test(String.fromCharCode(head[i]))) i++
    const c = String.fromCharCode(head[i])
    return (c === '{' || c === '[') && !startsWith(head, '{\\rtf', i)
  },

  formatLabel(file) { return extOf(file.name) || 'json' },

  async open([file], { container, settings, position, onRelocate }) {
    const text = await file.text()
    const root = el('div', { class: 'json-view' })
    container.append(root)

    let data
    try { data = parse(text, file.name) }
    catch (err) {
      root.append(el('div', { class: 'json-error' },
        el('h3', {}, 'This file is not valid JSON'),
        el('pre', {}, String(err.message)),
        el('p', { class: 'muted' }, 'Showing the raw text below.'),
        el('pre', {}, text.slice(0, RAW_LIMIT))))
      return basicSession(file, root)
    }

    // ---------- tree ----------
    const body = el('div', { class: 'json-body', tabindex: '0' })
    const results = el('div', { class: 'json-results', hidden: true })
    const search = el('input', { type: 'search', placeholder: 'Search keys and values…', 'aria-label': 'Search JSON' })
    const pathLabel = el('span', { class: 'muted', style: 'font-size:12px' })
    let raw = false
    const rawBtn = el('button', { class: 'btn', onclick: () => toggleRaw() }, 'Raw')
    const tools = el('div', { class: 'json-tools' },
      search,
      el('button', { class: 'btn', onclick: () => expandAll() }, 'Expand all'),
      el('button', { class: 'btn', onclick: () => collapseAll() }, 'Collapse'),
      rawBtn)
    root.append(tools, results, body)

    const nodes = new WeakMap() // li -> node

    function makeNode(key, value, path) {
      const li = el('li')
      const node = { key, value, path, li, ul: null, rendered: 0, open: false, childLis: new Map() }
      nodes.set(li, node)
      const row = el('div', { class: 'jn-row' })
      if (isContainer(value) && sizeOf(value)) {
        row.append(el('span', { class: 'jn-toggle', onclick: () => toggle(node) }, '▸'))
      } else row.append(el('span', { class: 'jn-toggle' }, ' '))
      if (key !== undefined) {
        row.append(el('span', {
          class: 'jn-key', title: pathToString(path),
          onclick: () => { pathLabel.textContent = pathToString(path); toggle(node) },
        }, typeof key === 'number' ? String(key) : JSON.stringify(key)), ': ')
      }
      if (isContainer(value)) row.append(el('span', { class: 'jn-sum' }, summary(value)))
      else row.append(primitive(value))
      li.append(row)
      node.row = row
      return node
    }

    function renderMore(node) {
      const entries = entriesOf(node.value)
      const end = Math.min(entries.length, node.rendered + CHUNK)
      node.ul.querySelector(':scope > .jn-more-li')?.remove()
      const frag = document.createDocumentFragment()
      for (let i = node.rendered; i < end; i++) {
        const [k, v] = entries[i]
        const child = makeNode(k, v, [...node.path, k])
        node.childLis.set(k, child)
        frag.append(child.li)
      }
      node.ul.append(frag)
      node.rendered = end
      if (end < entries.length) {
        node.ul.append(el('li', { class: 'jn-more-li' }, el('button', {
          class: 'jn-more', onclick: () => renderMore(node),
        }, `Show ${Math.min(CHUNK, entries.length - end)} more of ${entries.length - end} remaining…`)))
      }
    }

    function setOpen(node, open) {
      if (!isContainer(node.value) || !sizeOf(node.value)) return
      node.open = open
      node.row.querySelector('.jn-toggle').textContent = open ? '▾' : '▸'
      if (open && !node.ul) {
        node.ul = el('ul')
        node.li.append(node.ul)
        renderMore(node)
      }
      if (node.ul) node.ul.hidden = !open
    }
    const toggle = node => { setOpen(node, !node.open); report() }

    let rootNode
    function buildTree() {
      body.replaceChildren()
      const ul = el('ul')
      rootNode = makeNode(undefined, data, [])
      ul.append(rootNode.li)
      body.append(ul)
      setOpen(rootNode, true)
      // open the first level of a small top-level array/object
      if (isContainer(data) && sizeOf(data) <= 20)
        for (const child of rootNode.childLis.values()) setOpen(child, sizeOf(child.value ?? {}) <= 50)
    }

    function expandAll() {
      let budget = 5000
      const walk = node => {
        if (budget-- <= 0 || !isContainer(node.value)) return
        setOpen(node, true)
        for (const c of node.childLis.values()) walk(c)
      }
      walk(rootNode)
      if (budget <= 0) toast('Expanded the first 5,000 nodes')
      report()
    }
    const collapseAll = () => { buildTree(); body.scrollTop = 0; report() }

    function reveal(path) {
      if (raw) toggleRaw()
      let node = rootNode
      for (const k of path) {
        setOpen(node, true)
        while (!node.childLis.has(k) && node.rendered < sizeOf(node.value)) renderMore(node)
        node = node.childLis.get(k)
        if (!node) return
      }
      if (isContainer(node.value)) setOpen(node, true)
      node.row.scrollIntoView({ block: 'center' })
      node.row.classList.add('flash')
      setTimeout(() => node.row.classList.remove('flash'), 1400)
      pathLabel.textContent = pathToString(path)
    }

    function toggleRaw() {
      raw = !raw
      rawBtn.classList.toggle('primary', raw)
      if (raw) {
        const s = JSON.stringify(data, null, 2)
        body.replaceChildren(el('pre', { class: 'json-raw' },
          s.length > RAW_LIMIT ? s.slice(0, RAW_LIMIT) + '\n… (truncated)' : s))
      } else buildTree()
      body.scrollTop = 0
      report()
    }

    // ---------- search ----------
    function runSearch(q) {
      q = q.trim().toLowerCase()
      if (!q) { results.hidden = true; return }
      const hits = []
      const stack = [[data, []]]
      let visited = 0
      while (stack.length && hits.length < MAX_RESULTS && visited < 2e6) {
        const [v, path] = stack.pop()
        visited++
        const key = path[path.length - 1]
        const keyHit = typeof key === 'string' && key.toLowerCase().includes(q)
        if (isContainer(v)) {
          if (keyHit) hits.push([path, summary(v)])
          const e = entriesOf(v)
          for (let i = e.length - 1; i >= 0; i--) stack.push([e[i][1], [...path, e[i][0]]])
        } else if (keyHit || String(v).toLowerCase().includes(q)) {
          hits.push([path, JSON.stringify(v)])
        }
      }
      results.replaceChildren(
        el('div', { class: 'hint' }, hits.length
          ? `${hits.length}${hits.length >= MAX_RESULTS ? '+' : ''} match${hits.length === 1 ? '' : 'es'}`
          : 'No matches'),
        ...hits.map(([path, preview]) => el('button', {
          onclick: () => reveal(path), title: pathToString(path),
        }, el('span', { class: 'jn-key' }, pathToString(path)), '  ',
          el('span', { class: 'muted' }, String(preview).slice(0, 120)))))
      results.hidden = false
    }
    let searchTimer
    search.addEventListener('input', () => {
      clearTimeout(searchTimer)
      searchTimer = setTimeout(() => runSearch(search.value), 200)
    })
    search.addEventListener('keydown', e => {
      e.stopPropagation() // don't turn pages while typing
      if (e.key === 'Enter') results.querySelector('button')?.click()
      if (e.key === 'Escape') { search.value = ''; results.hidden = true }
    })

    // ---------- position ----------
    const fraction = () => {
      const max = body.scrollHeight - body.clientHeight
      return max > 0 ? body.scrollTop / max : 1
    }
    let raf
    const report = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const f = fraction()
        onRelocate({ fraction: f, label: `${Math.round(f * 100)}%`, chapter: pathLabel.textContent,
          position: { scroll: body.scrollTop, fraction: f } })
      })
    }
    body.addEventListener('scroll', report, { passive: true })

    const toast = msg => container.dispatchEvent(new CustomEvent('toast', { bubbles: true, detail: msg }))

    buildTree()

    const topLevel = isContainer(data) && !Array.isArray(data)
      ? Object.keys(data).slice(0, 500).map(k => ({ label: k, href: JSON.stringify([k]) }))
      : null

    const session = {
      title: file.name,
      author: `${typeOf(data)} · ${(file.size / 1024).toFixed(file.size < 10240 ? 1 : 0)} KB`,
      cover: null,
      toc: topLevel,
      capabilities: ['fontSize'],
      prev: () => body.scrollBy({ top: -body.clientHeight * 0.9 }),
      next: () => body.scrollBy({ top: body.clientHeight * 0.9 }),
      goTo: href => reveal(JSON.parse(href)),
      goToFraction: f => { body.scrollTop = f * (body.scrollHeight - body.clientHeight) },
      goToPosition: pos => { if (raw) toggleRaw(); body.scrollTop = pos?.scroll ?? 0 },
      samePosition: (a, b) => a && b && Math.abs((a.scroll ?? 0) - (b.scroll ?? 0)) < 24,
      applySettings(s) { root.style.setProperty('--json-scale', s.fontSize / 100) },
      destroy() { root.remove() },
    }
    session.applySettings(settings)
    if (position?.scroll) requestAnimationFrame(() => { body.scrollTop = position.scroll; report() })
    else report()
    return session
  },
}

function basicSession(file, root) {
  return {
    title: file.name, author: 'Invalid JSON', cover: null, toc: null, capabilities: [],
    prev() {}, next() {}, goTo() {}, goToFraction() {}, goToPosition() {}, applySettings() {},
    destroy() { root.remove() },
  }
}
