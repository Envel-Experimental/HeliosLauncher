# Distribution System

The distribution system delivers server configuration, module manifests, and staged rollout metadata from a remote JSON endpoint to the launcher.

---

## Distribution URL

Primary: `https://f-launcher.ru/fox/new/distribution.json`  
Mirror: `https://mirror.nikita.best/distribution.json`

Both are configured in `network/config.js` under `MOJANG_MIRRORS[*].distribution`.

---

## Fetch Strategy

`DistributionAPI.pullRemote()` races multiple URLs competitively:

1. Primary URL fires immediately.
2. Secondary URLs wait **500ms** before starting — giving the primary a head-start.
3. `Promise.any()` returns the first successful response.
4. If the primary is slow or down, a secondary wins and is logged.

Each URL is fetched with:
- 10s timeout
- `cache: 'no-store'`
- Followed by a `.sig` fetch for signature verification

---

## Signature Verification

Every distribution fetch is verified with **Ed25519** before being accepted.

### Process

1. Fetch `distribution.json` → raw `Buffer`
2. Fetch `distribution.json.sig` → hex-encoded Ed25519 signature
3. Call `SignatureUtils.verifyDistribution({ dataHex, signatureHex, trustedKeys })`
4. `trustedKeys` comes from `network/config.js` → `DISTRO_PUB_KEYS`:
   ```
   47719aff1f56160e4d07d6e35add3f31e1e96c918cc24e37fc569a9a99cc190f
   ```
5. If verification fails → throw, do not update local cache.

The same verification is applied to the Java mirror manifest (`java_manifest`) and is **mandatory** for custom mirrors.

### SignatureUtils Implementation

`app/assets/js/core/util/SignatureUtils.js` uses **WebCrypto** (`subtle.verify`) in the Renderer and **Node.js `crypto`** in Main. Ed25519 keys are imported as `raw` format (32-byte public key from hex string).

---

## Anti-Replay Protection

After signature verification, the timestamp is compared:

```js
const remoteTimestamp = new Date(data.timestamp || data.rss).getTime()
if (localTimestamp > 0 && remoteTimestamp < localTimestamp) {
    throw new Error('Distribution replay attack detected (downgrade attempt).')
}
```

`localTimestamp` is the `timestamp` field of the previously cached `distribution.json`. If a server tries to serve an older signed distribution (downgrade attack), it is rejected.

---

## Local Cache

On successful fetch + verification, the distribution is written to:
```
%APPDATA%\.foxford\distribution.json
```

On subsequent launches, the local file is read first. If the remote fetch fails, the local cache is used as fallback. If neither works → fatal error.

**Dev mode**: reads `distribution_dev.json` from the same directory instead. Falls back to production `distribution.json`, then remote.

---

## Distribution JSON Schema

```json
{
  "version": "1.0.0",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "rss": "https://f-launcher.ru/fox/new/distribution.json",
  "servers": [
    {
      "id": "server-id",
      "name": "Server Display Name",
      "description": "Human-readable description",
      "icon": "https://...",
      "version": "1.0.0",
      "address": "play.example.com",
      "minecraftVersion": "1.20.1",
      "mainServer": true,
      "autoconnect": false,
      "discord": { "clientId": "...", "smallImageText": "...", "smallImageKey": "..." },
      "javaOptions": {
        "supported": ">=21.0.0 <22",
        "suggestedMajor": 21,
        "distribution": "graalvm"
      },
      "rollout": {
        "percent": 100
      },
      "modules": [ ... ]
    }
  ]
}
```

### Server Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | ✓ | Unique server identifier. Used as key in config overrides. |
| `name` | string | ✓ | Display name in UI. |
| `description` | string | | Short description shown in server selection. |
| `icon` | string (URL) | | Server icon URL. |
| `version` | string | ✓ | Server modpack version. |
| `address` | string | | Game server address (`host:port`). |
| `minecraftVersion` | string | ✓ | Base game version (e.g. `"1.20.1"`). |
| `mainServer` | boolean | | If `true`, this is the default selected server. Only one should be `true`. |
| `autoconnect` | boolean | | Auto-connect to server on game start. |
| `discord` | object | | Discord Rich Presence configuration. |
| `javaOptions` | object | | Java version requirements (see below). |
| `rollout` | object | | Staged rollout percentage gate (see staged_rollouts.md). |
| `modules` | array | ✓ | List of module objects. |

### javaOptions

| Field | Type | Description |
|-------|------|-------------|
| `supported` | string (semver range) | Valid Java versions. E.g. `">=21.0.0 <22"` |
| `suggestedMajor` | number | Major version to download if no valid JVM found. |
| `distribution` | string | Preferred JDK distribution: `graalvm`, `temurin`, `corretto`. |

---

## Module Schema

Modules are files/libraries the launcher downloads before launching the game.

```json
{
  "id": "group:artifact:version@ext",
  "name": "Human Name",
  "type": "ForgeHosted",
  "artifact": {
    "size": 12345678,
    "MD5": "abc123...",
    "path": "path/relative/to/common/libraries",
    "url": "https://..."
  },
  "classpath": true,
  "required": { "value": true, "def": true },
  "subModules": [ ... ]
}
```

### Module Types

| Type | Description |
|------|-------------|
| `Library` | Generic library placed on classpath |
| `ForgeHosted` | Forge loader jar (on classpath, treated as loader) |
| `Fabric` | Fabric loader jar |
| `LiteLoader` | LiteLoader jar (legacy) |
| `ForgeMod` | Forge mod `.jar` (placed in `mods/`) |
| `FabricMod` | Fabric mod `.jar` (placed in `mods/`) |
| `LiteMod` | LiteMod file (legacy) |
| `File` | Generic file (config, resource pack, etc.) |
| `VersionManifest` | The vanilla game version manifest JSON |

### Module Resolution

`DistributionIndexProcessor` processes all modules and produces an `Asset[]` for `DownloadEngine`:

1. For each module: compute local path from `artifact.path` (resolved against `commonDir/libraries`).
2. Check if file exists and MD5 matches.
3. If missing or corrupted: add to download queue.
4. Recurse into `subModules`.

Mods marked `required.value: false` are optional. The user can toggle them in Settings. The `required.def` field sets the default enabled state.

---

## DistributionClasses

`DistributionAPI` wraps raw JSON in typed wrappers:

```
HeliosDistribution
  └── servers: HeliosServer[]
        └── modules: HeliosModule[]
              └── subModules: HeliosModule[]
```

**`HeliosServer`** provides:
- `getMainServer()` — the server marked as `mainServer: true`
- `getServerById(id)` — look up by ID

**`HeliosModule`** provides:
- `getPath()` — absolute disk path for the artifact
- `getVersionlessMavenIdentifier()` — `group:artifact` without version (for classpath dedup)

**`Type`** enum: `Library`, `ForgeHosted`, `Fabric`, `ForgeMod`, `FabricMod`, `File`, etc.

---

## Refreshing Distribution

`DistributionAPI.refreshDistributionOrFallback()` is called:
- On app startup (during `renderer-ready` flow)
- Periodically if configured
- On manual refresh from Settings

If the refresh fails (network error, signature mismatch), the existing in-memory distribution is kept and a warning is logged. The launcher does not fail-open to an unverified distribution.
