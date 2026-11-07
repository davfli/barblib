// Images: PNG, JPG, GIF, WebP, AVIF, BMP, SVG. Several images opened together
// become one "book" you page through (e.g. scanned pages).
import { extOf, startsWith, el } from '../util.js'

const EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'svg']

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export default {
  id: 'image',
  label: 'Image',
  extensions: EXT,

  detect(file, head) {
    if (EXT.includes(extOf(file.name))) return true
    if (file.type.startsWith('image/')) return true
    return head[0] === 0x89 && startsWith(head, 'PNG', 1)
      || head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
      || startsWith(head, 'GIF8')
      || startsWith(head, 'RIFF') && startsWith(head, 'WEBP', 8)
  },

  formatLabel(file) { return extOf(file.name) || 'img' },

  async open(files, { container, settings, position, onRelocate }) {
    files = [...files].sort((a, b) => natural.compare(a.name, b.name))
    const urls = files.map(f => URL.createObjectURL(f))
    const img = el('img', { alt: '', draggable: 'false' })
    const view = el('div', { class: 'img-view', tabindex: '-1' }, img)
    container.append(view)

    let index = Math.min(position?.index ?? 0, files.length - 1)
    const n = files.length

    const show = async i => {
      index = Math.max(0, Math.min(n - 1, i))
      img.src = urls[index]
      try { await img.decode() } catch { /* broken image: browser shows icon */ }
      view.scrollTo(0, 0)
      onRelocate({
        fraction: n > 1 ? index / (n - 1) : 1,
        label: n > 1 ? `${index + 1} / ${n}` : `${img.naturalWidth}×${img.naturalHeight}`,
        chapter: files[index].name,
        position: { index },
      })
    }

    // Double-click/tap toggles between "fit screen" and "100%"
    let fit = settings.fit
    view.addEventListener('dblclick', () => {
      session.applySettings({ ...settings, fit: fit === 'actual' ? 'contain' : 'actual' })
    })
    // Cover thumbnail for the library: the first image itself
    const cover = files[0]

    const session = {
      title: n > 1 ? `${files[0].name} + ${n - 1} more` : files[0].name,
      author: n > 1 ? `${n} images` : '',
      cover,
      capabilities: ['fit'],
      toc: n > 1 ? files.map((f, i) => ({ label: f.name, href: i })) : null,
      prev: () => show(index - 1),
      next: () => show(index + 1),
      goTo: href => show(Number(href)),
      goToFraction: f => show(Math.round(f * (n - 1))),
      goToPosition: pos => show(pos?.index ?? 0),
      samePosition: (a, b) => a?.index === b?.index,
      currentHref: () => index,
      applySettings(s) {
        settings = s
        fit = s.fit
        view.className = `img-view fit-${fit}`
      },
      destroy() {
        view.remove()
        urls.forEach(u => URL.revokeObjectURL(u))
      },
    }
    session.applySettings(settings)
    await show(index)
    return session
  },
}
