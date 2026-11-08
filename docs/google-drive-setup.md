# Connect barbLib to Google Drive (one-time setup, ~10 minutes)

barbLib has no server. It talks to Google Drive directly from your device, so
Google needs to know the app exists. You do this once; afterwards every device
just taps **Connect Google Drive**.

**What barbLib can access:** only files it created itself (the `barbLib` folder).
It cannot see anything else in your Drive. Google calls this the `drive.file`
permission, and it needs no review from Google.

---

## 0. Pick the account (recommended: a fresh one)

Create a new free Google account just for barbLib (e.g. `barblib.yourname@gmail.com`)
at <https://accounts.google.com/signup>. It gets its own 15 GB, and your main
mailbox stays untouched. Use this account for **all** steps below **and** when
you connect barbLib on each device.

## 1. Create a project

1. Open <https://console.cloud.google.com/> signed in with that account.
2. Accept the terms if asked.
3. Top bar → project picker → **New project** → name it `barbLib` → **Create**.
   Make sure `barbLib` is selected in the top bar afterwards.

## 2. Turn on the Drive API

1. Menu ☰ → **APIs & Services** → **Library**.
2. Search **Google Drive API** → open it → **Enable**.

## 3. Describe the app (consent screen)

1. Menu ☰ → **Google Auth Platform** (older consoles: *APIs & Services → OAuth consent screen*) → **Get started**.
2. **App name:** `barbLib`. **User support email:** your barbLib address → Next.
3. **Audience:** **External** → Next.
4. **Contact email:** your barbLib address → Next → agree → **Create**.
5. Go to **Audience** → under **Test users** → **Add users** → add your barbLib address → Save.
   (The app stays in "Testing" mode, which is fine: only the people you list can use it.)
6. Go to **Data access** → **Add or remove scopes** → filter for `drive.file` →
   tick **…/auth/drive.file** → **Update** → **Save**.

## 4. Create the client ID

1. Go to **Clients** (older consoles: *Credentials → Create credentials → OAuth client ID*) → **Create client**.
2. **Application type:** **Web application**. **Name:** `barbLib web`.
3. **Authorized JavaScript origins** → **Add URI**, add both:
   - `https://davfli.github.io`
   - `http://localhost:8642`
4. Leave *Authorized redirect URIs* empty → **Create**.
5. Copy the **Client ID**. It looks like `1234567890-abc123def456.apps.googleusercontent.com`.

The client ID is **not a secret**. It only identifies the app, and Google only
accepts it from the two addresses you listed. (Ignore the "client secret" if one is
shown; barbLib doesn't use it.)

## 5. Give it to barbLib

Either:

- **Send it to Claude** and it gets built into barbLib for every device (recommended), or
- paste it on each device: barbLib → ⚙ (gear) → **Cloud library** → paste → **Save**.

Then tap **☁ Connect** in the library bar (or ⚙ → **Connect Google Drive**), choose your barbLib account, and allow access.
"Google hasn't verified this app" may appear because the app is in testing mode:
click **Continue**. It's your own app.

---

## How it behaves

- Your books are uploaded to **My Drive → barbLib → books** as normal files.
  `library.json` holds positions, bookmarks, notes and folders.
- On another device, after connecting, your whole shelf appears. Books marked with a
  ☁ download the first time you open them. **⋯ → Remove download** frees space
  again without deleting anything.
- Deleting a book in barbLib moves its file to Drive's trash (recoverable for 30 days).
- Google sign-ins last about an hour. When it runs out, the cloud icon turns yellow:
  tap it (a small window flashes and closes) and syncing continues. Reading
  never stops: changes are saved on the device and sync afterwards.
