# Family Arcade for Windows

This x64 preview runs a selected set of Family Arcade activities from the copy
bundled with the program. It uses Microsoft Edge WebView2 and keeps its own
local settings and saves. Windows 11 x64 is the first target. WebView2 and
.NET 10 also support eligible Windows 10 editions and Arm64 platforms.
Those combinations need their own package and verification.
[WebView2 requirements](https://learn.microsoft.com/en-us/microsoft-edge/webview2/)
and [supported .NET versions on Windows](https://learn.microsoft.com/en-us/dotnet/core/install/windows).

## Open and use

1. Extract the whole ZIP into a folder you can access from your ordinary
   Windows account. Open `Arcade.exe` from that folder. The package includes
   its .NET runtime. Keep the accompanying files next to the executable.
   The `licenses` folder includes the runtime and WebView2 SDK notices.
   [.NET license information for Windows](https://github.com/dotnet/core/blob/main/license-information-windows.md).
2. If Arcade reports a missing WebView2 Runtime, a grown-up can install the
   Microsoft Edge WebView2 Evergreen Runtime. Microsoft also offers an x64
   offline installer. [Microsoft WebView2 download](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
3. Enter and confirm a parent password on the first launch. Keep it somewhere
   you can recover it. The native bar above the activities has **Home**,
   **Parent settings**, and **Exit**. Parent settings changes the password and
   controls which bundled activities appear. **Exit** asks for the password.
4. Windows may show a SmartScreen prompt because the preview is unsigned.
   Check the official build location and the supplied SHA-256 before
   opening an unsigned package.

The wrapper has its own offline launcher. It omits the browser version's
online and Nearby games and the activities that have yet to clear review for
the locked wrapper. It supports local play within the source-screened activities.
The exact build list is in [child-activities.json](child-activities.json).
Chat, TV, Comic Library, Retro Vault, and activities that provide general
file import or unreviewed device access are excluded. Curated Reference pages
share the same articles, words, and indices as the browser; they can read
aloud when Windows offers an installed matching voice.

## Owner recovery

Windows task switching, Ctrl+Alt+Delete, Task Manager and sign-out remain
available. The wrapper is designed to prevent accidental exits. A child
with access to the same Windows account can use its OS controls. Use a
separate Windows account and the appropriate Windows controls if the device
needs stronger restrictions.

For a forgotten password, use Task Manager's **Details** tab to end
**Arcade.exe**, then open
`%LOCALAPPDATA%\FamilyArcade` in File Explorer. Rename
`parent-settings.json` to `parent-settings.backup.json`. Reopen Arcade and
create a new password, then choose the allowed activities again. Keep the
`WebView2` folder to retain games' local saves. Restore the backup with Arcade
closed if you need the old settings and know the old password. The same
procedure recovers from a damaged settings file.

## Updates

An adult installs an update by extracting a verified official package into a
new folder and opening that copy. Verify the supplied SHA-256 against the
package before opening. Retain the prior folder to recover from a broken
update. Both copies refer to the same ordinary-user settings and save folder.
The Windows preview reads its runtime files from its own assembly. Network
update approval and download flows remain future work.

## Build and verify

Use Node.js 24, Python 3.12, .NET SDK 10.0.404, and a current Microsoft Edge
WebView2 Evergreen Runtime on Windows 11 to run the browser integration test.

```powershell
node windows-wrapper/prepare-snapshot.mjs
python windows-wrapper/zip-snapshot.py
dotnet run --project windows-wrapper/Arcade.Windows.Tests -c Release -- windows-wrapper/out/child-snapshot.zip
dotnet restore windows-wrapper/Arcade.Windows --locked-mode
dotnet publish windows-wrapper/Arcade.Windows -c Release --no-restore -o windows-wrapper/out/Arcade-Windows-x64
dotnet run --project windows-wrapper/Arcade.Windows.Tests -c Release -- windows-wrapper/out/child-snapshot.zip windows-wrapper/out/Arcade-Windows-x64/Arcade.dll
python windows-wrapper/package-windows.py --source-commit (git rev-parse HEAD)
dotnet restore windows-wrapper/Arcade.Windows.Smoke --locked-mode
dotnet run --project windows-wrapper/Arcade.Windows.Smoke -c Release --no-restore -- windows-wrapper/out/child-snapshot.zip
```

Preparation hashes every selected input against Arcade's offline manifest
before embedding it. It also checks the Reference packs against the approved editorial
records before embedding them. The child launcher is generated from the
native allowlist. The wrapper uses the exact asset paths from its embedded
package, checks each top-level activity against the parent's approved set,
and rejects subframe navigation. The browser runtime has a separate
profile and exposes neither native host objects nor a web message bridge.
The native filter, content policy, and WebView2 settings implement
request, permission, download and external URI controls.
[WebView2 security guidance](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/security).

## Windows acceptance checks

- Start with an ordinary Windows account and internet disconnected. Set and
  confirm a password. Open several games and the two reference activities.
  Return Home using both the native bar and game controls. Restart and verify
  a new bookmark or a game save survives.
- Try Cancel, an incorrect password twice, then the correct password. Verify
  native Exit, activity permissions and password changes. Revoke an activity,
  restart the app, and verify it is absent and direct navigation is denied.
- Test Alt+F4, taskbar/minimize, Ctrl+Alt+Delete, Task Manager recovery, loss of
  focus, multiple displays, scaling and sleep/resume. Reopen after a normal
  and a forced exit. Confirm recovery keeps existing saves.
- Exercise the approved games with a mouse, touch and keyboard at typical
  viewport sizes. Check both Reference activities with and without a local
  voice installed.

The policy suite on Linux exercises archive contents, exact path matching,
allowlist changes, password hashes and settings persistence. The Windows
smoke suite exercises the packaged WebView2 and expects a desktop-capable
Windows runner. Password prompts, real OS recovery and the physical device
checks above require a Windows desktop test.
