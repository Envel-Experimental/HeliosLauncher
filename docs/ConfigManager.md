# ConfigManager Reference

`app/assets/js/core/configmanager.js` — single source of truth for all user and launcher settings. Works in **both Main and Renderer** processes (detects `process.type`).

---

## Config File Location

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\.foxford\config.json` |
| macOS | `~/Library/Application Support/.foxford/config.json` |
| Linux | `~/.foxford/config.json` |

The directory (`.foxford`) is determined by `pathutil.js` using `os.homedir()` + platform heuristics.

---

## Full Config Schema

```ts
interface Config {
  settings: {
    game: {
      resWidth: number          // default: 1280
      resHeight: number         // default: 720
      fullscreen: boolean       // default: false
      launchDetached: boolean   // default: true  (game runs as detached child process)
    }
    launcher: {
      allowPrerelease: boolean  // default: false  (show pre-release game versions)
      dataDirectory: string     // default: ''     (empty = auto-resolved)
      totalRAMWarningShown: boolean // default: false
    }
    deliveryOptimization: {
      localOptimization: boolean   // default: false  (mDNS P2P on LAN)
      globalOptimization: boolean  // default: false  (global HyperSwarm P2P)
      p2pUploadEnabled: boolean    // default: false  (act as seeder)
      p2pUploadLimit: number       // default: 5      (MB/s upload cap)
      p2pOnlyMode: boolean         // default: false  (block HTTP for Mojang CDN)
      noMojang: boolean            // default: false  (skip Mojang CDN entirely)
      noServers: boolean           // default: false  (skip all HTTP, P2P only)
    }
    p2pPromptShown: boolean        // default: false  (one-time P2P consent dialog)
  }
  clientToken: string | null       // stable identity token (HWID or random UUID)
  selectedServer: string | null    // ID of the currently selected game server
  selectedAccount: string | null   // UUID of the active auth account
  authenticationDatabase: {
    [uuid: string]: AuthAccount
  }
  modConfigurations: {
    [serverId: string]: ModConfig
  }
  javaConfig: {
    minRAM: string                 // e.g. '2G'
    maxRAM: string                 // e.g. '4G'
    overrides?: {
      [serverId: string]: { minRAM?: string, maxRAM?: string }
    }
  }
  supportUrl: string | null        // URL opened on crash-support action
  lastLauncherVersion: string | null  // Used to detect launcher updates for analytics
}
```

---

## Important Getter Methods

### Data Directory

```js
ConfigManager.getLauncherDirectory()       // async → string
ConfigManager.getLauncherDirectorySync()   // sync  → string
```

Returns the resolved data directory. If `settings.launcher.dataDirectory` is empty, defaults to:
- Windows: `%APPDATA%\.foxford`
- macOS: `~/Library/Application Support/.foxford`
- Linux: `~/.foxford`

The common directory (where game versions, libraries, assets are stored) is:
```js
path.join(launcherDirectory, 'common')
```

The instance directory (per-server game files) is:
```js
path.join(launcherDirectory, 'instances')
```

### Java Settings

```js
ConfigManager.getJavaConfig()             // → { minRAM, maxRAM, overrides }
ConfigManager.getMinRAM(serverId?)        // → string (e.g. '2G'), respects per-server override
ConfigManager.getMaxRAM(serverId?)        // → string (e.g. '4G'), respects per-server override
ConfigManager.getJVMOptions(serverId?)    // → string[]  extra JVM flags
```

Per-server overrides take precedence over global `javaConfig.minRAM` / `javaConfig.maxRAM`.

### Game Settings

```js
ConfigManager.getGameWidth()         // → number
ConfigManager.getGameHeight()        // → number
ConfigManager.getFullscreen()        // → boolean
ConfigManager.getLaunchDetached()    // → boolean
```

### Delivery Optimization

```js
ConfigManager.getLocalP2PEnabled()    // → boolean  (localOptimization)
ConfigManager.getGlobalP2PEnabled()   // → boolean  (globalOptimization)
ConfigManager.getP2PUploadEnabled()   // → boolean
ConfigManager.getP2PUploadLimit()     // → number   (MB/s)
ConfigManager.getP2POnlyMode()        // → boolean
```

### Auth

```js
ConfigManager.getAuthAccount(uuid)         // → AuthAccount | null
ConfigManager.getSelectedAccount()         // → AuthAccount | null
ConfigManager.addAuthAccount(account)      // mutates in-memory config
ConfigManager.removeAuthAccount(uuid)      // mutates in-memory config
ConfigManager.getClientToken()             // → string | null
ConfigManager.setClientToken(token)        // mutates in-memory config
```

### Server Selection

```js
ConfigManager.getSelectedServer()          // → string | null  (server ID)
ConfigManager.setSelectedServer(id)        // mutates in-memory config
```

### Mod Configurations

```js
ConfigManager.getModConfiguration(serverId)       // → ModConfig
ConfigManager.setModConfiguration(serverId, cfg)  // mutates in-memory config
```

---

## Loading and Saving

```js
await ConfigManager.load()    // Read config.json from disk. Creates default if missing.
await ConfigManager.save()    // Write current in-memory config to disk (atomic write).
ConfigManager.isLoaded()      // → boolean
```

`save()` uses `safeWriteJson()` to perform an atomic write (writes to a temporary file, then performs a retry-backed rename). This prevents file corruption in case of a crash or power loss during the save process.

`load()` validates the loaded JSON against defaults. Missing keys are filled in from `DEFAULT_CONFIG`. No schema migration is performed — adding new keys with defaults is backward-compatible; removing keys is not.

---

## Security: Input Validation

`SecurityUtils.js` is used to sanitize certain string inputs (server IDs, paths) before they are stored in config. This prevents config-injection attacks where a malicious distribution could write arbitrary keys.

---

## Process Awareness

`configmanager.js` detects whether it's running in Main or Renderer via `process.type === 'renderer'`. In Renderer:
- File I/O goes through IPC (`config:load`, `config:save` channels).
- `getLauncherDirectorySync()` is backed by a `sendSync` IPC call.

In Main:
- File I/O is direct (`fs/promises`).

This dual-mode design means the same module can be `require()`d from both processes without branching at call sites.

---

## fetchWithTimeout

`configmanager.js` also exports a `fetchWithTimeout(url, options, timeoutMs)` utility used by `DistributionAPI` and other modules. It wraps `fetch()` with an `AbortController` timeout.
