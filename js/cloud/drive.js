// Minimal Google Drive client for the browser.
//
// Sign-in uses Google Identity Services (token model): no server, no secrets.
// Scope `drive.file` = barbLib can only see files it created itself, never the
// rest of your Drive. Tokens last ~1 hour; renewing needs a click (a tiny
// pop-up that closes itself once you've agreed the first time).
import { GOOGLE_CLIENT_ID } from '../config.js'

const API = 'https://www.googleapis.com/drive/v3'
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3'
const SCOPE = 'https://www.googleapis.com/auth/drive.file'
const FOLDER = 'application/vnd.google-apps.folder'
const CHUNK = 8 * 1024 * 1024 // resumable chunk size (multiple of 256 KB)

export class NeedAuthError extends Error { constructor() { super('Sign-in needed') } }

const TOKEN_KEY = 'barblib.gtoken'
let token = null
let expiresAt = 0
try {
  const t = JSON.parse(sessionStorage.getItem(TOKEN_KEY) || 'null')
  if (t && t.expiresAt > Date.now() + 60_000) ({ token, expiresAt } = t)
} catch { /* ignore */ }

export const clientId = () => GOOGLE_CLIENT_ID || (() => {
  try { return localStorage.getItem('barblib.clientId') || '' } catch { return '' }
})()
export const isConfigured = () => !!clientId()
export const hasToken = () => !!token && Date.now() < expiresAt - 60_000

let gisLoading
function loadGIS() {
  gisLoading ??= new Promise((resolve, reject) => {
    if (globalThis.google?.accounts?.oauth2) return resolve()
    const s = document.createElement('script')
    s.src = 'https://accounts.google.com/gsi/client'
    s.async = true
    s.onload = resolve
    s.onerror = () => { gisLoading = null; reject(new Error("Couldn't reach Google sign-in")) }
    document.head.append(s)
  })
  return gisLoading
}
/** Preload the sign-in script so a later click can open the pop-up immediately. */
export const preload = () => isConfigured() ? loadGIS().catch(() => {}) : Promise.resolve()

/**
 * Get an access token. Must be called from a click/tap (pop-up blockers).
 * `consent` forces the account chooser (first connect / switching accounts).
 */
export async function signIn({ consent = false, hint } = {}) {
  if (!isConfigured()) throw new Error('Google Drive is not set up yet')
  await loadGIS()
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId(),
      scope: SCOPE,
      prompt: consent ? 'select_account consent' : '',
      hint,
      callback: res => {
        if (res.error) return reject(new Error(res.error_description || res.error))
        token = res.access_token
        expiresAt = Date.now() + (Number(res.expires_in) || 3600) * 1000
        try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, expiresAt })) } catch { /* ignore */ }
        resolve(token)
      },
      error_callback: err => reject(new Error(err?.type === 'popup_closed' ? 'Sign-in was closed' : err?.message || 'Sign-in failed')),
    })
    client.requestAccessToken()
  })
}

export function signOut() {
  if (token && globalThis.google?.accounts?.oauth2) google.accounts.oauth2.revoke(token, () => {})
  token = null
  expiresAt = 0
  try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
}

// ---------------- requests ----------------
async function request(url, opts = {}) {
  if (!hasToken()) throw new NeedAuthError()
  const res = await fetch(url, { ...opts, headers: { Authorization: `Bearer ${token}`, ...opts.headers } })
  if (res.status === 401) { token = null; throw new NeedAuthError() }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`
    try { msg = (await res.json()).error?.message || msg } catch { /* not json */ }
    throw new Error(`Google Drive: ${msg}`)
  }
  return res
}
const json = async (url, opts) => (await request(url, opts)).json()
const q = params => new URLSearchParams(params).toString()

export const about = () => json(`${API}/about?fields=user(emailAddress,displayName)`)

export async function list(query, fields = 'id,name,size,mimeType,modifiedTime,appProperties') {
  const out = []
  let pageToken
  do {
    const r = await json(`${API}/files?${q({
      q: `${query} and trashed = false`, fields: `nextPageToken,files(${fields})`,
      pageSize: 1000, spaces: 'drive', ...(pageToken ? { pageToken } : {}),
    })}`)
    out.push(...r.files)
    pageToken = r.nextPageToken
  } while (pageToken)
  return out
}

export async function findOrCreateFolder(name, parentId = 'root') {
  const safe = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const [found] = await list(`name = '${safe}' and mimeType = '${FOLDER}' and '${parentId}' in parents`, 'id,name')
  if (found) return found.id
  const r = await json(`${API}/files?fields=id`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: FOLDER, parents: [parentId] }),
  })
  return r.id
}

export async function findFile(name, parentId) {
  const safe = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const [f] = await list(`name = '${safe}' and '${parentId}' in parents`)
  return f ?? null
}

/** Download a file's content as Blob (progress: fraction 0..1). */
export async function download(id, onProgress) {
  const res = await request(`${API}/files/${id}?alt=media`)
  const total = Number(res.headers.get('Content-Length')) || 0
  if (!onProgress || !total || !res.body) return res.blob()
  const reader = res.body.getReader()
  const chunks = []
  let got = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    got += value.length
    onProgress(got / total)
  }
  return new Blob(chunks, { type: res.headers.get('Content-Type') || '' })
}

export const downloadJSON = async id => JSON.parse(await (await download(id)).text())

/**
 * Create (no fileId) or overwrite (fileId) a file. Small files go in one request,
 * big ones in resumable chunks so progress can be shown and failures retried.
 */
export async function upload({ blob, name, parentId, fileId, mimeType, appProperties, onProgress }) {
  const type = mimeType || blob.type || 'application/octet-stream'
  const meta = fileId ? {} : { name, parents: [parentId], ...(appProperties ? { appProperties } : {}) }
  const method = fileId ? 'PATCH' : 'POST'
  const base = `${UPLOAD}/files${fileId ? `/${fileId}` : ''}`

  if (blob.size <= 5 * 1024 * 1024) {
    const body = new FormData()
    body.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }))
    body.append('file', blob, name)
    const r = await json(`${base}?uploadType=multipart&fields=id,size`, { method, body })
    onProgress?.(1)
    return r
  }

  const start = await request(`${base}?uploadType=resumable&fields=id,size`, {
    method,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': type, 'X-Upload-Content-Length': String(blob.size) },
    body: JSON.stringify(meta),
  })
  const session = start.headers.get('Location')
  if (!session) throw new Error('Google Drive did not start the upload')
  let offset = 0
  for (;;) {
    const end = Math.min(offset + CHUNK, blob.size)
    const res = await fetch(session, {
      method: 'PUT',
      headers: { 'Content-Range': `bytes ${offset}-${end - 1}/${blob.size}` },
      body: blob.slice(offset, end),
    })
    if (res.status === 308) { // chunk stored, continue from what Google confirms
      const range = res.headers.get('Range')
      offset = range ? Number(range.split('-')[1]) + 1 : end
      onProgress?.(offset / blob.size)
      continue
    }
    if (!res.ok) throw new Error(`Google Drive upload failed: ${res.status}`)
    onProgress?.(1)
    return res.json()
  }
}

export const uploadJSON = (obj, { name, parentId, fileId }) => upload({
  blob: new Blob([JSON.stringify(obj)], { type: 'application/json' }), name, parentId, fileId, mimeType: 'application/json',
})

/** Moves to Drive's trash (recoverable for 30 days), not a permanent delete. */
export const trash = id => request(`${API}/files/${id}?fields=id`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }),
}).catch(e => { if (!/404/.test(e.message)) throw e })
