# Download System

The download system fetches, verifies, and caches all game assets. It is designed around a **P2P-or-HTTP race** with cryptographic integrity verification.

---

## Components

| Module | Role |
|--------|------|
| `DownloadEngine.js` | Parallel download queue, retry logic, progress reporting |
| `DistributionIndexProcessor.js` | Builds Asset list from distribution modules |
| `MojangIndexProcessor.js` | Builds Asset list from vanilla version manifests |
| `FullRepair.js` | Pre-launch verification + repair orchestrator |
| `Asset.js` | Asset descriptor `{ path, hash, size, algo }` |
| `HashVerifierStream.js` | Transform stream for on-the-fly hash verification |
| `RaceManager.js` | Protocol-level HTTP/P2P race (in `network/`) |

---

## Asset Pipeline

```
FullRepair.verify()
    │
    ├─► DistributionIndexProcessor.process(server)
    │       For each server module (and sub-modules):
    │         - Compute local path
    │         - Check file exists and MD5 matches
    │         - If missing/corrupt → add to Asset[] queue
    │
    ├─► MojangIndexProcessor.process(server)
    │       Downloads/checks:
    │         - Version manifest JSON
    │         - Client JAR
    │         - Asset index JSON
    │         - Asset objects (sounds, textures, etc.)
    │         - Libraries (JARs, natives)
    │       Each is an Asset with { path, hash, size, algo: SHA1 | SHA256 }
    │
    └─► DownloadEngine.download(assets[])
            Parallel queue → fetches via mc-asset:// protocol
            → Electron intercepts → RaceManager.handle()
            → P2P or HTTP wins → HashVerifierStream → write to disk
```

---

## DownloadEngine

### Parallel Concurrency

Concurrency is dynamic based on the number of P2P peers:

```
slots = clamp(peerCount * PEER_CONCURRENCY_FACTOR, MIN_PARALLEL_DOWNLOADS, MAX_PARALLEL_DOWNLOADS)
     = clamp(peerCount * 8, 8, 32)
```

With 0 peers: 8 parallel downloads (HTTP only).  
With 4 peers: 32 parallel downloads (capped).

### Request Headers

Each download request to `mc-asset://` includes custom headers that `RaceManager` reads:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-File-Path` | Relative path | Logging, P2P peer lookup |
| `X-File-Id` | Module ID | Logging fallback |
| `X-File-Hash` | SHA-1 or SHA-256 hex | P2P lookup key |
| `X-Expected-Size` | bytes | P2P size enforcement, >200MB → skip P2P |
| `X-Skip-P2P` | `'1'` | Force HTTP (used for very large files) |

### Retry Logic

Failed downloads are retried up to **3 times** with exponential backoff. On all retries exhausted, `AssetGuardError` is thrown and the launch is aborted with an error message.

### Progress Reporting

`DownloadEngine` emits progress events consumed by `FullRepair`, which forwards them to the Renderer via IPC to update the progress bar.

---

## Mirror System

`MirrorManager.js` manages the list of HTTP mirrors for Mojang assets.

### Mirror Structure

```js
{
  name: "Fox 1 Mirror",
  assets: "https://f-launcher.ru/fox/new/mirror/assets/objects",
  libraries: "https://f-launcher.ru/fox/new/mirror/libraries",
  client: "https://f-launcher.ru/fox/new/mirror/client",
  version_manifest: "https://f-launcher.ru/fox/new/mirror/metadata/version_manifest_v2.json",
  piston_meta: "https://f-launcher.ru/fox/new/mirror/metadata",
  launcher_meta: "https://f-launcher.ru/fox/new/mirror/metadata",
  java_manifest: "https://f-launcher.ru/fox/new/mirror/java/manifest.json",
  distribution: "https://f-launcher.ru/fox/new/distribution.json"
}
```

### Latency Measurement

`MirrorManager.init(mirrors)` and `measureAllLatencies()`:
1. HEAD-requests a known small file from each mirror.
2. Records response time in milliseconds.
3. `getSortedMirrors()` returns mirrors sorted by latency (fastest first).

Mirrors are re-probed on `mirrors:refresh` IPC call (Settings UI).

### URL Rewriting

When a URL originates from Mojang CDN, `MirrorManager` rewrites it to the fastest mirror:

- `resources.download.minecraft.net/objects/{hash[0:2]}/{hash}` → `mirror.assets/{hash[0:2]}/{hash}`
- `libraries.minecraft.net/{path}` → `mirror.libraries/{path}`

This rewriting happens at the `mc-asset://` protocol level in `RaceManager` and `MojangIndexProcessor`.

---

## HashVerifierStream

`network/HashVerifierStream.js` is a Node.js `Transform` stream that:

1. Accumulates all chunks.
2. On `_flush()`: computes SHA-1 or SHA-256 over the full content.
3. Compares against the expected hash.
4. If mismatch: emits `error` event (causes download retry).
5. If match: passes all chunks through to the destination.
6. Optionally checks `expectedSize` against actual byte count.

Supported algorithms: `sha1`, `sha256`, `none` (no verification — used for files without a known hash).

---

## Protocol Handler: `mc-asset://`

Registered in `index.js`:

```js
protocol.handle('mc-asset', (req) => RaceManager.handle(req))
```

The Electron session also has a redirect hook:
```js
session.defaultSession.webRequest.onBeforeRequest(
  { urls: ['*://resources.download.minecraft.net/*', '*://libraries.minecraft.net/*'] },
  (details, callback) => {
    callback({ redirectURL: 'mc-asset://' + details.url.replace(/^https?:\/\//, '') })
  }
)
```

This means any `fetch()` or `<script src="...">` that hits Mojang CDN is transparently intercepted and routed through RaceManager — without any change to calling code.

---

## RaceManager — Detailed Flow

See [P2PEngine.md](./P2PEngine.md#racemanager--http-vs-p2p-arbitration) for the full race arbitration logic.

**Key points for DownloadEngine integration:**
- If P2P wins, `RaceManager` returns `{ ok: true, p2pStream: ReadableStream }`.
- `DownloadEngine` detects `p2pStream` and reads from it instead of calling `response.body`.
- If HTTP wins, `RaceManager` returns the native `Response` object directly.
- Both paths end in `HashVerifierStream` for integrity validation (P2P path wraps in verifier inside RaceManager; HTTP path validates after write).

---

## Mojang Index Processor

`MojangIndexProcessor` handles the vanilla game manifest chain:

```
version_manifest_v2.json
    └── <version>.json (e.g. 1.20.1.json)
            ├── client JAR download
            ├── libraries[] → each library's artifact + classifiers
            ├── assetIndex: { id, url, sha1 }
            │       └── asset_index/<id>.json
            │               └── objects: { "path": { hash, size } }
            │                       → one Asset per object file
            └── javaVersion: { majorVersion }
```

Each step fetches from the fastest available mirror. All fetched manifests are cached to disk in `commonDir/`.

---

## Distribution Index Processor

`DistributionIndexProcessor` walks the `HeliosModule` tree for a server:

```
for each module in server.modules:
    if module.artifact is missing or MD5 mismatch:
        → add to download queue
    for each subModule:
        recurse
```

Paths are resolved relative to `commonDir/libraries` for library types, and relative to the server instance directory for mods and config files.
