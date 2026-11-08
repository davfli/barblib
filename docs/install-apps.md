# Installing barbLib as an app

All versions load barbLib from <https://davfli.github.io/barblib/>, so **app updates
arrive by themselves**: when a new version is published, barbLib shows *"A new
version is ready → Update now"*. You only reinstall a package if its icon, name or
permissions change.

## Windows

**Option A, simplest (recommended):** open <https://davfli.github.io/barblib/> in
Microsoft Edge → click the **Install barbLib** icon at the right end of the address bar
(or ⋯ → Apps → Install this site as an app). You get a Start-menu entry, taskbar pin,
its own window, uninstall via Settings → Apps, and "Open with → barbLib" in Explorer.

**Option B, Windows package (MSIX test package):**
1. Unzip `barbLib - Windows test package.zip`.
2. In that folder: right-click `install.ps1` → **Run with PowerShell**. If Windows refuses
   to run scripts, open PowerShell in the folder and run
   `powershell -ExecutionPolicy Bypass -File .\install.ps1`.
3. If the install is refused, turn on **Settings → System → For developers → Developer Mode**
   and run it again.

(`barbLib.msixbundle` and `barbLib.classic.appxbundle` are for a Microsoft Store
submission later. Ignore them for now.)

## Android

1. Copy `barbLib.apk` to your phone (e.g. upload it to Google Drive and open it there,
   or USB).
2. Tap it → allow your browser / Files app to **install unknown apps** when asked → **Install**.
3. Open barbLib from the app drawer.

The app opens barbLib full-screen once `https://davfli.github.io/.well-known/assetlinks.json`
is online. Until then it shows a thin address bar at the top; everything works anyway.

**Alternative without the APK:** open the link in Chrome → ⋮ → **Install app**.

## The Android signing key (important)

`signing.keystore` + `signing-key-info.txt` (passwords inside) prove that a future
barbLib APK comes from you. Android only installs an update over the existing app if
it's signed with the **same key**, and Google Play requires it too.

- Keep both files somewhere safe and private (not in the public GitHub repo).
- You only need them to build a new APK, e.g. for a new icon or a Play Store release.
  Normal barbLib updates never need them.

## iPhone / iPad

Safari → open the link → Share → **Add to Home Screen**.
