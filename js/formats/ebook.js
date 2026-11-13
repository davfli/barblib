// EPUB, PDF, Kindle (MOBI / AZW / AZW3), FB2, CBZ — rendered by foliate-js.
import { extOf, startsWith } from '../util.js'

const EXT = ['epub', 'pdf', 'mobi', 'azw', 'azw3', 'prc', 'fb2', 'fbz', 'fb2.zip', 'cbz']

const PALETTES = {
  light: { bg: '#fffdf8', fg: '#23201b', link: '#9a3f1b' },
  sepia: { bg: '#f4ead5', fg: '#3b2f20', link: '#8a3f12' },
  dark:  { bg: '#1b1a18', fg: '#dcd6cb', link: '#f0a57f' },
  night: { bg: '#000000', fg: '#b8946a', link: '#d39a62' },   // dim amber on black
}

const FONTS = {
  publisher: null,
  serif: 'Georgia, "Iowan Old Style", "Palatino Linotype", "Book Antiqua", Cambria, serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  clear: 'Verdana, "Atkinson Hyperlegible", Tahoma, "DejaVu Sans", sans-serif',
}

const WIDTHS = { narrow: '520px', normal: '720px', wide: '1100px' }

const NAV_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown', ' '])

/**
 * Scroll mode: the engine shows one chapter at a time, so the mouse wheel / a
 * swipe used to stop dead at a chapter's end. Keep pushing past the end (or the
 * start) and the next (previous) chapter loads. A small push is needed first so
 * you don't skip chapters by accident.
 */
function createOverscroll(view) {
  const PUSH = 220          // px of extra wheel/swipe needed at an edge
  let pushed = 0, dirSeen = 0, resetTimer, busy = false, touchY = null
  const r = () => view.renderer
  const atEnd = () => r().viewSize - r().end <= 2
  const atStart = () => r().start <= 1
  const go = async dir => {
    if (busy) return
    busy = true
    pushed = 0
    try { await (dir > 0 ? view.next() : view.prev()) } finally { setTimeout(() => { busy = false }, 400) }
  }
  const feed = dy => {
    if (!r()?.scrolled || busy || !dy) return
    const dir = Math.sign(dy)
    const atEdge = dir > 0 ? atEnd() : atStart()
    if (!atEdge || dir !== dirSeen) { pushed = 0; dirSeen = dir; if (!atEdge) return }
    pushed += Math.abs(dy)
    clearTimeout(resetTimer)
    resetTimer = setTimeout(() => { pushed = 0 }, 600)
    if (pushed >= PUSH) go(dir)
  }
  return {
    watch(target) {
      target.addEventListener('wheel', e => feed(e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY), { passive: true })
      target.addEventListener('touchstart', e => { touchY = e.touches[0]?.clientY ?? null }, { passive: true })
      target.addEventListener('touchend', e => {
        if (touchY == null || !r()?.scrolled) return
        const dy = touchY - (e.changedTouches[0]?.clientY ?? touchY)
        touchY = null
        if (Math.abs(dy) < 80) return
        const dir = Math.sign(dy)
        if (dir > 0 ? atEnd() : atStart()) go(dir)
      }, { passive: true })
    },
  }
}

const bookCSS = ({ theme, fontSize, font, lineHeight, justify }) => {
  const p = PALETTES[theme] ?? PALETTES.light
  const family = FONTS[font]
  return `
    html { color-scheme: ${theme === 'dark' || theme === 'night' ? 'dark' : 'light'}; }
    html, body { background: ${p.bg} !important; color: ${p.fg} !important; }
    html { font-size: ${fontSize}% !important; }
    body * { color: inherit !important; background-color: transparent !important; border-color: currentColor; }
    a:any-link { color: ${p.link} !important; }
    ${family ? `body, body p, body div, body span, body li, body td, body blockquote, body h1, body h2, body h3, body h4 { font-family: ${family} !important; }` : ''}
    p, li, blockquote, dd, div { line-height: ${lineHeight} !important; }
    p { text-align: ${justify ? 'justify' : 'start'}; hyphens: ${justify ? 'auto' : 'manual'}; -webkit-hyphens: ${justify ? 'auto' : 'manual'}; }
    pre { white-space: pre-wrap !important; }
    img, svg, video { max-width: 100%; }
    ${theme === 'dark' ? 'img { filter: brightness(.88); }' : ''}
    ${theme === 'night' ? 'img { filter: brightness(.6) sepia(.4); }' : ''}
  `
}

const fmtLang = x => !x ? '' : typeof x === 'string' ? x : Object.values(x)[0] ?? ''
const fmtAuthor = a => Array.isArray(a)
  ? a.map(fmtAuthor).filter(Boolean).join(', ')
  : typeof a === 'string' ? a : fmtLang(a?.name)

export default {
  id: 'ebook',
  label: 'Book',
  extensions: EXT,

  detect(file, head) {
    if (EXT.includes(extOf(file.name))) return true
    if (startsWith(head, '%PDF-')) return true
    if (startsWith(head, 'BOOKMOBI', 60)) return true            // MOBI / AZW / AZW3
    if (startsWith(head, 'PK\x03\x04') && !/\.(zip|docx|xlsx)$/i.test(file.name)) return true // EPUB/CBZ
    return false
  },

  formatLabel(file) {
    const e = extOf(file.name)
    return e ? e.replace('.zip', '') : 'book'
  },

  async open([file], { container, settings, position, onRelocate }) {
    await import('../../vendor/foliate-js/view.js')
    const view = document.createElement('foliate-view')
    container.append(view)
    await view.open(file)

    const { book } = view
    const fixed = view.isFixedLayout
    const overscroll = createOverscroll(view)
    overscroll.watch(view)
    const isPDF = /\.pdf$/i.test(file.name) || book.metadata?.format === 'pdf'

    // load errors inside books (missing images etc.) shouldn't kill the reader
    book.transformTarget?.addEventListener('data', ({ detail }) => {
      detail.data = Promise.resolve(detail.data).catch(() => '')
    })

    const filterClasses = ['pdf-dark', 'pdf-sepia', 'pdf-night']
    const session = {
      title: fmtLang(book.metadata?.title) || file.name.replace(/\.[^.]+$/, ''),
      author: fmtAuthor(book.metadata?.author),
      cover: null,
      toc: book.toc?.length ? book.toc : null,
      capabilities: fixed ? [] : ['fontSize', 'typography', 'flow'],
      _href: null,
      prev: () => view.prev(),
      next: () => view.next(),
      goTo: href => view.goTo(href).catch(e => console.warn(e)),
      goToFraction: f => view.goToFraction(f),
      // Up/Down keys: a few lines in scroll mode (continuing into the next/previous
      // chapter at the ends), a page in page mode
      lineScroll(dir) {
        const r = view.renderer
        if (!r.scrolled) return dir > 0 ? view.next() : view.prev()
        const step = Math.max(60, r.size * 0.15)
        return dir > 0 ? view.next(step) : view.prev(step)
      },
      async goToPosition(pos) {
        if (pos?.cfi) { try { await view.goTo(pos.cfi); return } catch { /* fall back */ } }
        if (pos?.fraction != null) await view.goToFraction(pos.fraction)
      },
      samePosition: (a, b) => !!a?.cfi && a.cfi === b?.cfi,
      currentHref: () => session._href,
      getSelectionText() {
        for (const { doc } of view.renderer.getContents?.() ?? []) {
          const t = doc?.getSelection?.()?.toString()
          if (t?.trim()) return t
        }
        return ''
      },
      applySettings(s) {
        view.renderer.setStyles?.(bookCSS(s))
        if (!fixed) {
          view.renderer.setAttribute('flow', s.flow)
          view.renderer.setAttribute('max-inline-size', WIDTHS[s.width] ?? WIDTHS.normal)
          view.renderer.setAttribute('gap', s.width === 'wide' ? '4%' : '6%')
        }
        container.classList.remove(...filterClasses)
        if (fixed && isPDF && s.theme !== 'light') container.classList.add(`pdf-${s.theme}`)
      },
      destroy() {
        view.close?.()
        try { book.destroy?.() } catch { /* already closed */ } // stops PDF background rendering
        view.remove()
        container.classList.remove(...filterClasses)
      },
    }

    // the cover is only needed the first time (library thumbnail): fetch it lazily,
    // because for PDFs it means rendering page 1 (~0.5 s for scans)
    session.getCover = async () => { try { return await book.getCover?.() ?? null } catch { return null } }

    const total = book.sections?.length ?? 0
    view.addEventListener('relocate', ({ detail }) => {
      const { fraction = 0, tocItem, section, cfi, range } = detail
      session._href = tocItem?.href ?? null
      const label = fixed && section ? `${section.current + 1} / ${total}` : `${Math.round(fraction * 100)}%`
      let snippet = ''
      try { snippet = range?.toString().replace(/\s+/g, ' ').trim().slice(0, 90) ?? '' } catch { /* detached */ }
      onRelocate({
        fraction, label, snippet,
        chapter: tocItem?.label?.trim() ?? '',
        position: { cfi, fraction },
      })
    })

    // keyboard + tap zones inside the book's iframes
    view.addEventListener('load', ({ detail: { doc } }) => {
      doc.addEventListener('keydown', e => {
        if (NAV_KEYS.has(e.key) && !e.target.closest?.('input, textarea, select, [contenteditable]')) e.preventDefault()
        container.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, bubbles: true }))
      })
      overscroll.watch(doc)
      doc.addEventListener('click', e => {
        if (e.defaultPrevented || e.target.closest?.('a')) return
        if (!doc.getSelection()?.isCollapsed) return
        const frame = doc.defaultView?.frameElement
        if (!frame) return
        const r = frame.getBoundingClientRect()
        const scale = frame.clientWidth ? r.width / frame.clientWidth : 1
        const x = r.left + e.clientX * scale
        container.dispatchEvent(new CustomEvent('stage-tap', { bubbles: true, detail: { x } }))
      })
    })

    session.applySettings(settings)
    await view.init({ lastLocation: position?.cfi ?? null })
    // CFI restore can fail for odd files — fall back to the saved fraction
    if (position?.fraction && !view.lastLocation) await view.goToFraction(position.fraction)
    return session
  },
}
