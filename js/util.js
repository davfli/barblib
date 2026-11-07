export const extOf = name => {
  const lower = name.toLowerCase()
  if (lower.endsWith('.fb2.zip')) return 'fb2.zip'
  const i = lower.lastIndexOf('.')
  return i < 0 ? '' : lower.slice(i + 1)
}

export const startsWith = (head, str, offset = 0) =>
  [...str].every((c, i) => head[offset + i] === c.charCodeAt(0))

export const el = (tag, props = {}, ...children) => {
  const e = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v
    else if (k === 'dataset') Object.assign(e.dataset, v)
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v)
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v)
  }
  e.append(...children.flat().filter(c => c !== null && c !== undefined && c !== false))
  return e
}
