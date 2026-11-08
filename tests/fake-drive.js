// In-memory stand-in for js/cloud/drive.js, used to test the sync engine
// without a Google account. Same function names and behaviour.
export function createFakeDrive() {
  const files = new Map() // id -> { id, name, parents, mimeType, blob, trashed, appProperties }
  let n = 0
  let authed = true
  const id = () => `f${++n}`
  const live = () => [...files.values()].filter(f => !f.trashed)
  return {
    files, live,
    setAuthed: v => { authed = v },
    hasToken: () => authed,
    preload: async () => {},
    signIn: async () => { authed = true },
    signOut: () => { authed = false },
    about: async () => ({ user: { emailAddress: 'test@example.com' } }),
    async findOrCreateFolder(name, parentId = 'root') {
      const f = live().find(x => x.name === name && x.parents[0] === parentId && x.mimeType === 'folder')
      if (f) return f.id
      const nf = { id: id(), name, parents: [parentId], mimeType: 'folder' }
      files.set(nf.id, nf)
      return nf.id
    },
    async findFile(name, parentId) {
      return live().find(x => x.name === name && x.parents[0] === parentId) ?? null
    },
    async download(fid, onProgress) {
      const f = files.get(fid)
      if (!f || f.trashed) throw new Error('Google Drive: 404 File not found')
      onProgress?.(1)
      return f.blob
    },
    async downloadJSON(fid) { return JSON.parse(await (await this.download(fid)).text()) },
    async upload({ blob, name, parentId, fileId, mimeType, appProperties, onProgress }) {
      if (fileId) {
        const f = files.get(fileId)
        f.blob = blob
        onProgress?.(1)
        return { id: fileId, size: blob.size }
      }
      const nf = { id: id(), name, parents: [parentId], mimeType: mimeType || blob.type, blob, appProperties }
      files.set(nf.id, nf)
      onProgress?.(1)
      return { id: nf.id, size: blob.size }
    },
    uploadJSON(obj, { name, parentId, fileId }) {
      return this.upload({ blob: new Blob([JSON.stringify(obj)], { type: 'application/json' }), name, parentId, fileId })
    },
    async trash(fid) { const f = files.get(fid); if (f) f.trashed = true },
  }
}
