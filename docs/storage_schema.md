# Storage Schema

All files written to disk by FLauncher, their locations, formats, and lifecycle.

---

## Base Directory

Determined by `ConfigManager.getLauncherDirectory()`:

| Platform | Default Path |
|----------|-------------|
| Windows | `%APPDATA%\.foxford\` |
| macOS | `~/Library/Application Support/.foxford/` |
| Linux | `~/.foxford/` |

Users can override via `settings.launcher.dataDirectory` in config. The override path is resolved through `pathutil.js`.

---

## File Inventory

### `config.json`
**Path**: `<launcherDir>/config.json`  
**Format**: JSON  
**Written by**: `ConfigManager.save()`  
**Read by**: `ConfigManager.load()` (Main and Renderer)  
**Content**: Full launcher configuration (Minecraft access tokens are encrypted on disk; Microsoft OAuth access/refresh tokens are stored in plaintext). See [ConfigManager.md](./ConfigManager.md) for schema.  
**Lifecycle**: Created on first run with defaults. Never deleted automatically.

---

### `distribution.json`
**Path**: `<launcherDir>/distribution.json`  
**Format**: JSON  
**Written by**: `DistributionAPI.writeDistributionToDisk()`  
**Read by**: `DistributionAPI.pullLocal()`  
**Content**: Cached server distribution manifest fetched from remote.  
**Lifecycle**: Overwritten on successful remote fetch + signature verification. Kept as fallback if remote is unavailable.

---

### `distribution_dev.json`
**Path**: `<launcherDir>/distribution_dev.json`  
**Format**: JSON  
**Written by**: Developer manually places this file.  
**Read by**: `DistributionAPI` in dev mode (`!app.isPackaged`).  
**Content**: Local override distribution for development testing.  
**Lifecycle**: Not managed by the launcher. Must be created/deleted manually.

---

### `peers.json`
**Path**: `<launcherDir>/peers.json`  
**Format**: JSON  
**Written by**: `PeerPersistence`  
**Read by**: `P2PEngine.start()`  
**Content**: Array of previously seen peer addresses/keys for fast reconnection.  
**Lifecycle**: Updated periodically while P2P is running. Loaded at startup to skip DHT discovery cold-start.

---

### `stats.json`
**Path**: `<launcherDir>/stats.json`  
**Format**: JSON  
**Written by**: `StatsManager`  
**Read by**: `StatsManager` on startup  
**Content**:
```json
{
  "all": { "uploaded": 12345678, "downloaded": 98765432 },
  "month": { "uploaded": 1234567, "downloaded": 9876543, "year": 2024, "month": 1 },
  "week": { "uploaded": 123456, "downloaded": 987654, "year": 2024, "week": 5 }
}
```
**Lifecycle**: Written on each significant transfer event. Month/week windows reset automatically based on calendar comparison.

---

### `runtime/<arch>/`
**Path**: `<launcherDir>/runtime/<arch>/` (e.g. `runtime/x64/`)  
**Written by**: `JavaGuard` (extraction step)  
**Content**: Extracted JDK directory (e.g. `jdk-21.0.3+9/`) and the downloaded archive before extraction.  
**Lifecycle**: Archive deleted after extraction. JDK directory kept until a new version is installed or user clears it.

---

### `common/`
**Path**: `<launcherDir>/common/`  
**Written by**: `DownloadEngine` via `DistributionIndexProcessor` and `MojangIndexProcessor`  
**Content**:
```
common/
├── versions/
│   └── 1.20.1/
│       ├── 1.20.1.json      ← version manifest
│       └── 1.20.1.jar       ← game client JAR
├── assets/
│   ├── indexes/
│   │   └── 17.json          ← asset index
│   └── objects/
│       └── ab/
│           └── ab1234...    ← hashed asset objects (sounds, textures)
└── libraries/
    └── <maven-path>/
        └── artifact.jar
```
**Lifecycle**: Files are downloaded on first play or when corrupted. Verified on every launch by `FullRepair`.

---

### `instances/<serverId>/`
**Path**: `<launcherDir>/instances/<serverId>/`  
**Written by**: `DownloadEngine`, game process  
**Content**:
```
instances/server-id/
├── mods/           ← server-managed mods (togglable in UI)
├── config/         ← game config files (from distribution)
├── resourcepacks/
├── saves/          ← game save data (written by the game)
├── screenshots/
├── logs/
└── crash-reports/  ← read by GameCrashHandler
```
**Lifecycle**: Instance directory created on first launch of a server. `saves/`, `screenshots/` etc. are user data and must never be deleted automatically.

---

## Electron / System Files

### `app.getPath('userData')`
Electron's default userData path (different from `.foxford`). Used by:
- `electron-updater` for update cache
- Sentry for offline event queue

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\FLauncher` |
| macOS | `~/Library/Application Support/FLauncher` |
| Linux | `~/.config/FLauncher` |

---

## Temp Files

### Native library extraction
**Path**: OS temp directory + unique subfolder (e.g. `os.tmpdir()/flauncher-natives-<hash>/`)  
**Content**: Extracted `.dll` / `.so` / `.dylib` files needed for launch.  
**Lifecycle**: Created before game launch, deleted after the game process exits (best-effort).

---

## File Write Safety

- `config.json`: Written atomically using `safeWriteJson()` (writes to a temporary file `<config>.tmp.<timestamp>.<random>`, then performs a retry-backed `fs.rename` up to 5 times). This prevents partial writes on crash or power loss.
- `distribution.json`: Written with `fs.writeFile()` directly. No atomic rename.
- All other files: Written by `DownloadEngine` which verifies hash after write. Corrupted files are detected on next launch and re-downloaded.

> **Known limitation**: `distribution.json` writes are not atomic. A power loss during write could corrupt this file. A corrupted `distribution.json` is automatically handled on the next launch by falling back to a remote fetch.
