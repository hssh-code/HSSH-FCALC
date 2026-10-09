# LoadLens as a macOS and Windows app

There are two ways to get LoadLens on the Dock or Start menu. Start with
**Option A**; it takes a minute. Use **Option B** when you want real
installer files to hand out.

| | Option A: Install from the website | Option B: Installer files (.dmg, .exe) |
| --- | --- | --- |
| Effort | 1 minute | About 15 minutes the first time |
| Needs | The site published (see [PUBLISH-ON-GITHUB.md](PUBLISH-ON-GITHUB.md)) | GitHub Actions (already set up in this repo) |
| Updates | Automatic | Install the new version |
| Size | Tiny | About 100 MB (includes its own browser engine) |
| Works offline | Yes, after the first visit | Yes |

---

## Option A: Install from the website

Open **https://hssh-code.github.io/HSSH-FCALC/** and:

- **Chrome or Edge (Mac or Windows):** click the **Install** icon at the right
  end of the address bar (or the **Install app** button in LoadLens's header).
  LoadLens gets its own window, Dock or taskbar icon, and Start menu or
  Launchpad entry.
- **Safari on macOS Sonoma or later:** **File > Add to Dock**.

To remove it, open the app and use its menu (Chrome: **Uninstall LoadLens**),
or drag it out of the Applications folder on a Mac.

---

## Option B: Build installer files with GitHub Actions

The workflow `.github/workflows/desktop.yml` builds on GitHub's own Mac and
Windows machines, so you do not need both computers. You get:

| File | For |
| --- | --- |
| `LoadLens-1.0.0-mac-arm64.dmg` | Macs with Apple chips (M1 and newer) |
| `LoadLens-1.0.0-mac-x64.dmg` | Older Intel Macs |
| `LoadLens-Setup-1.0.0.exe` | Windows installer (Start menu, uninstaller) |
| `LoadLens-1.0.0-portable.exe` | Windows, runs without installing |

### Make a release (recommended)

1. Finish Step 1 of [PUBLISH-ON-GITHUB.md](PUBLISH-ON-GITHUB.md) so `main` exists.
2. On the repository page, click **Releases** (right side), then **Draft a new release**.
3. Click **Choose a tag**, type `v1.0.0`, and click **Create new tag: v1.0.0 on publish**. Target: `main`.
4. Title it `LoadLens 1.0.0` and click **Publish release**.
5. Open the **Actions** tab and watch **Build desktop apps**. It takes about
   10 minutes. When it is green, the four files are attached to the release.

Share the release page link. People download the file for their computer.

### Just testing a build

**Actions > Build desktop apps > Run workflow**. When it finishes, the files are
in the **Artifacts** section at the bottom of the run page (as zips).

### Releasing a new version

1. Change `"version"` in `package.json` (for example `1.0.0` to `1.1.0`).
2. Commit to `main`.
3. Make a new release with a matching tag (`v1.1.0`).

---

## First launch on each computer

The builds are not signed with a paid Apple or Microsoft certificate yet, so
each computer asks once whether to trust the app. This is normal for
in-house apps.

### macOS

1. Open the `.dmg` and drag **LoadLens** into **Applications**.
2. Open it. macOS says it cannot verify the developer. Click **Done**.
3. Open **System Settings > Privacy & Security**, scroll down, and click
   **Open Anyway** next to the LoadLens message. Confirm with your password.

It opens normally from then on.

If macOS instead says the app **"is damaged and can't be opened"**, the
download was quarantined. Open **Terminal** and run:

```bash
xattr -cr "/Applications/LoadLens.app"
```

### Windows

1. Run `LoadLens-Setup-1.0.0.exe`.
2. If you see **"Windows protected your PC"**, click **More info**, then **Run anyway**.
3. Follow the installer. LoadLens appears in the Start menu.

---

## Build on your own computer (optional)

Useful when you change the app and want to try it before releasing.

1. Install **Node.js 22 LTS or newer** from https://nodejs.org
2. Get the code: GitHub Desktop **Clone**, or `git clone https://github.com/hssh-code/HSSH-FCALC.git`
3. In a terminal, inside the project folder:

```bash
npm install         # one time, about 200 MB of build tools
npm start           # opens LoadLens in a desktop window
npm run dist:mac    # on a Mac: builds the .dmg files into dist/
npm run dist:win    # on Windows: builds the .exe files into dist/
```

A Mac build needs a Mac, and a Windows build is simplest on Windows. That is
why the GitHub Actions route is easier.

---

## Removing the security prompts (when you are ready)

Signing tells macOS and Windows who made the app, so people can open it
without the extra steps above. It costs money and is optional.

### macOS: Apple Developer ID

1. Join the [Apple Developer Program](https://developer.apple.com/programs/) (USD 99 per year).
2. Create a **Developer ID Application** certificate, then export it from
   Keychain Access as a `.p12` file with a password.
3. Create an **App Store Connect API key** (Users and Access > Integrations)
   for notarization. Download the `.p8` key file.
4. In GitHub: **Settings > Secrets and variables > Actions**, add:
   - `CSC_LINK`: the `.p12` file converted to base64 (`base64 -i cert.p12 | pbcopy`)
   - `CSC_KEY_PASSWORD`: the `.p12` password
   - `APPLE_API_KEY_BASE64`: the `.p8` file in base64
   - `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`: from the App Store Connect page
5. In `package.json`, inside `"mac"`, delete the line `"identity": "-",` and
   change `"hardenedRuntime": false` to `true`.
6. In `.github/workflows/desktop.yml`, replace the **Build installers** step with:

```yaml
      - name: Build installers
        shell: bash
        run: |
          if [ "$RUNNER_OS" = "macOS" ]; then
            echo "$APPLE_API_KEY_BASE64" | base64 --decode > "$RUNNER_TEMP/apple_api_key.p8"
            export APPLE_API_KEY="$RUNNER_TEMP/apple_api_key.p8"
          else
            unset CSC_LINK CSC_KEY_PASSWORD
          fi
          npx electron-builder ${{ matrix.target }} --publish never
        env:
          CSC_LINK: ${{ secrets.CSC_LINK }}
          CSC_KEY_PASSWORD: ${{ secrets.CSC_KEY_PASSWORD }}
          APPLE_API_KEY_BASE64: ${{ secrets.APPLE_API_KEY_BASE64 }}
          APPLE_API_KEY_ID: ${{ secrets.APPLE_API_KEY_ID }}
          APPLE_API_ISSUER: ${{ secrets.APPLE_API_ISSUER }}
```

electron-builder then signs and notarizes the Mac app automatically.

### Windows: code signing certificate

The usual choices are **Azure Trusted Signing** (low monthly fee, for
organizations with a verifiable history) or an **OV/EV code signing
certificate** from a certificate authority. Each comes with its own setup
instructions for electron-builder. SmartScreen warnings fade as more people
install a signed app.

---

## How the desktop app is put together

- `electron/main.js` opens the same `index.html` used by the website in a
  native window. The calculator code is shared, so a fix in one place fixes
  the website and both desktop apps.
- The app has no network access needs and no access to your files. Links to
  websites open in your normal browser.
- Saved items and the current sheet are stored inside the app's own data
  folder on that computer.
- `package.json` (the `"build"` section) controls the installer names,
  icon and targets. The icon comes from `build/icon.png`.
