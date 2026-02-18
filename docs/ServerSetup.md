# Server-Side Setup Guide

This document describes how to set up the server infrastructure required for the Launcher's **Auto-Update System** and **Java Runtime Mirroring**.

## 1. Auto-Update System (Backup Mirror)

The launcher uses `github` as the primary update source.
This configuration adds a **Backup Mirror** using the `generic` provider.
If GitHub is unreachable, the launcher will check:
`https://f-launcher.ru/fox/new/updates`

### Required Files
When you build the launcher using `npm run dist`, `electron-builder` generates several files in the `dist` directory. You must upload these to your server.

#### For Windows:
-   `latest.yml`: Contains version info and sha512 checksums. **Critical for updates.**
-   `Flauncher-setup-X.Y.Z.exe`: The installer file.

#### For macOS:
-   `latest-mac.yml`: Equivalent to `latest.yml` but for macOS.
-   `Flauncher-setup-X.Y.Z.dmg`: The DMG file.
-   `Flauncher-setup-X.Y.Z-mac.zip`: Zip update file (often used for auto-updates).

#### For Linux:
-   `latest-linux.yml`: Equivalent to `latest.yml`.
-   `Flauncher-X.Y.Z.AppImage`: The AppImage file.

### Update Metadata Files (`latest.yml`)

These files (`latest.yml`, `latest-mac.yml`, `latest-linux.yml`) are **generated automatically** by `electron-builder` when you run `npm run dist`. You usually do not clean write them by hand, but you must upload them.

However, if you need to understand their structure or debug issues, here is what they look like:

#### `latest.yml` (Windows)
```yaml
version: 2.4.0
files:
  - url: Flauncher-setup-2.4.0.exe
    sha512: <LONG_BASE64_STRING>
    size: 65432100
path: Flauncher-setup-2.4.0.exe
sha512: <LONG_BASE64_STRING>
releaseDate: '2026-02-05T12:00:00.000Z'
```

#### `latest-mac.yml` (macOS)
```yaml
version: 2.4.0
files:
  - url: Flauncher-setup-2.4.0-mac.zip
    sha512: <LONG_BASE64_STRING>
    size: 65432100
  - url: Flauncher-setup-2.4.0.dmg
    sha512: <LONG_BASE64_STRING>
    size: 67432100
path: Flauncher-setup-2.4.0-mac.zip
sha512: <LONG_BASE64_STRING>
releaseDate: '2026-02-05T12:00:00.000Z'
```

**Key Fields:**
*   `version`: The version number of the update.
*   `path`: The primary file to download (relative to the YAML file).
*   `sha512`: The checksum of the file to verify integrity. **Critical**.
*   `releaseDate`: Timestamp.

### Directory Structure Example
Your web server at `https://f-launcher.ru/fox/new/updates/` should serve exactly these filenames:

```
/updates/
├── latest.yml                  <-- Windows metadata
├── Flauncher-setup-2.4.0.exe   <-- Windows installer
├── latest-mac.yml              <-- macOS metadata
├── Flauncher-setup-2.4.0.dmg   <-- macOS installer
├── Flauncher-setup-2.4.0-mac.zip <-- macOS zip (required for auto-update)
└── ...
```

**Important:**
*   The `url` inside the YAML files is usually just the filename (e.g., `Flauncher-setup-2.4.0.exe`).
*   This means the EXE/DMG must be in the **same folder** as the YAML file on your server.

---

## 2. Java Runtime Mirroring

The launcher supports mirroring Java Runtimes (JDKs/JREs). 
**Note:** The launcher will attempt to download from Official sources (BellSoft/GitHub/Adoptium) *first*. 
If those fail, it will check the `java_manifest` URL defined in `network/config.js` as a **fallback**.

### Configuration
The launcher checks the `java_manifest` URL defined in `network/config.js`.
Default: `https://f-launcher.ru/fox/new/mirror/java/manifest.json`

### Manifest Structure (`manifest.json`)
You must host a JSON file that maps OS/Arch/Version to a download URL.

**Format:**
```json
{
  "windows": {
    "x64": {
      "8": {
        "url": "https://f-launcher.ru/fox/new/mirror/java/jdk-8-win-x64.zip",
        "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        "type": "temurin"
      },
      "17": {
        "url": "https://f-launcher.ru/fox/new/mirror/java/jdk-17-win-x64.zip",
        "sha256": "...",
        "type": "graalvm"
      },
      "21": {
        "url": "https://f-launcher.ru/fox/new/mirror/java/jdk-21-win-x64.zip",
        "sha256": "..."
      }
    },
    "arm64": { ... }
  },
  "linux": {
    "x64": { ... },
    "arm64": { ... }
  },
  "darwin": {
    "x64": { ... },
    "arm64": { ... }
  }
}
```

### Hosting Java Binaries
1.  Download the required JDKs (Jre 8, JDK 17, JDK 21) for all platforms.
2.  Upload them to your mirror (e.g., `/mirror/java/`).
3.  Calculate their SHA256 hashes.
4.  Update `manifest.json` with the new URLs and Hashes.

### How it Works
1.  Launcher attempts to resolve Java 17 via Official APIs (BellSoft/GitHub).
2.  **If that fails**, it checks `manifest.json`.
3.  If `windows.x64.17` exists in the manifest, it uses the provided `url` and `sha256`.
