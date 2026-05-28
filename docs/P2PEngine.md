# P2P Engine

The P2P system (`network/`) delivers game assets from other launcher users over a **HyperSwarm DHT** network, racing against HTTP mirrors. It is designed to be transparent, bandwidth-fair, and cryptographically safe.

---

## Components

| File | Role |
|------|------|
| `P2PEngine.js` | Core: peer management, DHT join, file request dispatch |
| `PeerHandler.js` | Per-connection state machine: upload/download logic, security enforcement |
| `RaceManager.js` | HTTP vs P2P race arbitration for every asset request |
| `MirrorManager.js` | HTTP mirror latency tracking and selection |
| `NodeAdapter.js` | Dynamic upload weight adjustment (AIMD-style) |
| `HashVerifierStream.js` | Transform stream that validates SHA-1/SHA-256 on the fly |
| `PeerPersistence.js` | Saves/loads known-good peer list to disk |
| `StatsManager.js` | Tracks upload/download bytes by time window (all/month/week) |
| `TrafficState.js` | Shared counter for active concurrent downloads |
| `config.js` | Bootstrap nodes, mirror URLs, sovereign infrastructure |
| `constants.js` | Wire protocol opcodes, rate-limit values, concurrency limits |

---

## Network Topology

```
┌────────────────────────────────────────────────────────────┐
│                   HyperSwarm DHT                           │
│                                                            │
│  Bootstrap Nodes (sovereign VPS fleet + public fallback):  │
│    195.201.148.171:49737  (private, has publicKey)         │
│    89.23.113.35:49737     (private, has publicKey)         │
│    node1/2/3.hyperdht.org:49737  (public fallback)         │
│                                                            │
│  Topic: SHA-256('zombie-launcher-assets-v2')               │
└───────────────────┬────────────────────────────────────────┘
                    │ encrypted TCP connections
         ┌──────────┴──────────┐
     FLauncher A          FLauncher B
   (leecher/seeder)    (leecher/seeder)
         │                    │
    PeerHandler          PeerHandler
    (per connection)     (per connection)
```

All connections are **encrypted by HyperSwarm** (Noise protocol). The fixed topic `SHA-256('zombie-launcher-assets-v2')` ensures only compatible launcher versions find each other.

---

## Wire Protocol

Messages are framed as **binary packets** with a 1-byte type prefix followed by a JSON body.

| Opcode | Constant | Description |
|--------|----------|-------------|
| `0` | `MSG_REQUEST` | Client requests a single file by hash |
| `1` | `MSG_DATA` | Seeder sends a chunk of file data |
| `2` | `MSG_ERROR` | Seeder signals an error (Not Found, Busy, etc.) |
| `3` | `MSG_END` | Transfer completed successfully |
| `4` | `MSG_HELLO` | Initial handshake with protocol version |
| `5` | `MSG_PING` | Keepalive ping |
| `6` | `MSG_PONG` | Keepalive pong |
| `7` | `MSG_BATCH_REQUEST` | Client requests up to 50 files at once |

### Handshake
On connection, both sides exchange `MSG_HELLO` containing `{ version: 1 }`. Mismatched versions cause immediate disconnect.

### File Request Flow
```
Client                          Seeder
  │── MSG_REQUEST { hash } ───►  │
  │                              │ (locates file, checks credits)
  │◄── MSG_DATA { chunk } ───────│
  │◄── MSG_DATA { chunk } ───────│  (repeated)
  │◄── MSG_END ──────────────────│
```

### Batch Request
```
Client                              Seeder
  │── MSG_BATCH_REQUEST { hashes[] } ──► │
  │◄── MSG_DATA (file 1 chunks) ─────────│
  │◄── MSG_END  (file 1 done) ───────────│
  │◄── MSG_DATA (file 2 chunks) ─────────│
  │◄── MSG_END  (file 2 done) ───────────│
```
Max batch size: **50 hashes** (`BATCH_SIZE_LIMIT`).

---

## P2PEngine Lifecycle

### `P2PEngine.start()`
1. Reads `ConfigManager` for upload enable/disable, upload limit.
2. Checks kill-switch URL (`https://f-launcher.ru/fox/new/p2poff.json`).
3. Joins the HyperSwarm topic (DHT + mDNS).
4. Loads saved peers from `PeerPersistence`.
5. On each `swarm.on('connection')`: wraps in a new `PeerHandler`, adds to `this.peers`.

### Peer lifecycle
```
swarm connection → PeerHandler created → MSG_HELLO exchanged
      │
      ├─► (seeder role): file requests arrive via MSG_REQUEST
      │                  → credit check → file read → MSG_DATA chunks → MSG_END
      │
      └─► (leecher role): P2PEngine.requestFile() sends MSG_REQUEST
                          → waits for MSG_DATA stream → resolve(ReadableStream)
```

### `P2PEngine.requestFile(hash, expectedSize, relPath, fileId)`
Returns a **Node.js Readable stream** that emits file data chunks. The stream resolves when the first data byte arrives (used as the "win" signal in RaceManager).

---

## RaceManager — HTTP vs P2P Arbitration

`RaceManager.handle(request)` is called for **every asset request** (invoked by `protocol.handle('mc-asset', ...)`).

```
Incoming mc-asset://... request
         │
         ├──► Extract: hash, relPath, fileId, expectedSize from headers
         │
         ├──► Skip P2P if:
         │      • X-Skip-P2P header present
         │      • expectedSize > 200 MB
         │      • P2PEngine overloaded
         │      • No peers + discovery timeout (5s grace)
         │
         ├──► Race: Promise.any([httpTask, globalP2PTask])
         │
         │    httpTask: fetch(url) with 10s timeout
         │              blocked by P2P-only mode for Mojang domains
         │
         │    globalP2PTask: P2PEngine.requestFile()
         │                   with 60s soft timeout
         │
         └──► Winner:
               HTTP  → return Response directly (no extra wrapping)
               P2P   → pipe through HashVerifierStream → return { ok, p2pStream }
                        cancel HTTP, increment p2pConsecutiveWins
                        if wins ≥ 10 → NodeAdapter.boostWeight()
```

### P2P Only Mode
When `ConfigManager.getP2POnlyMode()` is `true`, the HTTP task is blocked for Mojang CDN domains. Non-Mojang URLs (custom mirrors) still use HTTP.

### Hash Algorithm Detection
- 40-char hex → SHA-1
- 64-char hex → SHA-256
- Extracted from URL path if not in `X-File-Hash` header

---

## Fair-Use Credit System (Upload Side)

Implemented in `UsageTracker` (inside `P2PEngine.js`):

| Constant | Value | Meaning |
|----------|-------|---------|
| `MAX_CREDITS_PER_IP` | 5000 MB | Token bucket size per peer |
| `CREDIT_REGEN_RATE` | 0.5 MB/s | Credit recovery speed |
| `COST_PER_MB` | 1.0 | 1 credit consumed per 1 MB sent |
| `MIN_CREDITS_TO_START` | 100 MB | Minimum buffer to accept a new upload |

A new peer starts with `2500 MB` (50% of max). If a peer's credits drop below `MIN_CREDITS_TO_START`, new uploads to them are refused. Credits regenerate at 0.5 MB/s (~120 MB/min → full refill in ~42 minutes from zero).

Memory guard: tracker map is capped at **5000 entries**. Oldest entry is evicted when the limit is hit. Entries older than **2 hours** are purged on cleanup.

---

## Adaptive Upload Rate Limiting (AIMD)

`NodeAdapter.js` implements an AIMD (Additive Increase, Multiplicative Decrease) algorithm:

| Constant | Value |
|----------|-------|
| `MIN_UPLOAD_LIMIT_MBPS` | 1 Mbps |
| `MAX_UPLOAD_LIMIT_MBPS` | 15 Mbps |
| `ADDITIVE_INCREASE_MBPS` | +0.5 Mbps every 5s |
| `SLOW_START_MULTIPLIER` | ×1.5 in slow-start phase |
| `RTT_CONGESTION_DELTA_MS` | 50ms — triggers backoff |
| `MAX_ADAPTIVE_SLOTS` | 6 simultaneous upload slots |

If P2P consecutive wins ≥ 10, `NodeAdapter.boostWeight()` is called, which increases the upload allowance.

---

## Concurrency Limits

| Constant | Value | Meaning |
|----------|-------|---------|
| `MAX_CONCURRENT_UPLOADS` | 20 | Max simultaneous outgoing transfers |
| `MIN_PARALLEL_DOWNLOADS` | 8 | Never fewer than 8 parallel downloads |
| `MAX_PARALLEL_DOWNLOADS` | 32 | Never more than 32 parallel downloads |
| `PEER_CONCURRENCY_FACTOR` | 8 | `parallelSlots = peerCount × 8` (clamped) |

---

## Security: PeerHandler Safeguards

`PeerHandler.js` is the security boundary for incoming peer requests. Multiple layers:

### 1. File whitelist / blacklist
Only files matching an explicit **extension whitelist** are served. Files matching a **path blacklist** (e.g. config files, credentials) are refused regardless of extension.

### 2. Path traversal prevention
On upload, the requested hash is looked up on disk. The resolved path is validated with `fs.realpathSync()` to canonicalize symlinks. Any path that does not resolve strictly inside the launcher's asset store is rejected.

### 3. Rate limiting (`RateLimiter.js`)
Per-peer request rate limiter. Excessive request rates result in temporary connection suspension.

### 4. Strike system
`P2PEngine.peerStrikes` tracks failed or abusive interactions per peer IP/key. On threshold, the peer is added to `P2PEngine.blacklist` and the connection is terminated.

### 5. Max file size enforcement
Files larger than **200 MB** are never served over P2P (enforced in both RaceManager and PeerHandler).

---

## Peer Persistence

`PeerPersistence.js` saves known-good peer addresses to `%APPDATA%\.foxford\peers.json`. On next startup, these peers are attempted first before DHT discovery completes, reducing cold-start latency.

---

## Stats Tracking

`StatsManager.js` accumulates `{ uploaded, downloaded }` bytes in three time windows:
- **All time**
- **Current month** (resets on calendar month change)
- **Current week** (resets on Monday)

Stats are persisted to disk and exposed via `p2p:getStats` IPC.

---

## Kill Switch

On startup, `P2PEngine.start()` checks `https://f-launcher.ru/fox/new/p2poff.json`. If the file indicates P2P is disabled, the engine exits without joining the swarm. This allows remotely disabling P2P without a launcher update.
