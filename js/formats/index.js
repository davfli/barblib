/*
 * Format registry.
 *
 * Every readable format is a "handler" module that default-exports:
 *
 *   {
 *     id: 'json',                       // stable id, stored in the library
 *     label: 'JSON',                    // shown on the cover badge
 *     extensions: ['json'],             // used for detection + help text
 *     detect(file, head) -> boolean     // head = first 64 bytes (Uint8Array)
 *     open(files, ctx) -> session       // see below
 *   }
 *
 *   ctx     = { container, settings, position, onRelocate(info) }
 *   info    = { fraction: 0..1, label: string, position: any (saved & restored) }
 *   session = {
 *     title, author, cover (Blob|null), toc ([{label, href, subitems}]|null),
 *     capabilities: ['fontSize', 'typography', 'flow', 'fit'],  // settings that apply
 *     prev(), next(), goTo(href), goToFraction(f),
 *     goToPosition(position),          // jump to a saved position (bookmarks)
 *     samePosition(a, b) -> boolean,   // is this bookmark the current page?
 *     applySettings(settings), destroy(),
 *     currentHref?(),                  // highlights the current TOC entry
 *     getSelectionText?()              // for "Quote selection" in notes
 *   }
 *   info also may carry { chapter, snippet } for nicer labels.
 *
 * To add a format: write a handler in this folder and add it to `handlers`
 * below. Order matters: the first handler whose detect() returns true wins.
 */
import json from './json.js'
import image from './image.js'
import ebook from './ebook.js'

export const handlers = [json, image, ebook]

export { extOf } from '../util.js'

export const getHandler = id => handlers.find(h => h.id === id)

export async function detect(file) {
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  for (const h of handlers) if (await h.detect(file, head)) return h
  return null
}

export const allExtensions = () => handlers.flatMap(h => h.extensions)
