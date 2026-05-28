# Game Launch Pipeline

Full sequence from "Play" button click to the game process running.

Key modules:
- `app/assets/js/core/LaunchController.js` — orchestrator
- `app/assets/js/core/game/LaunchArgumentBuilder.js` — JVM/classpath construction
- `app/assets/js/core/game/ModConfigResolver.js` — mod enable/disable logic
- `app/assets/js/core/dl/FullRepair.js` — pre-launch asset verification
- `app/assets/js/core/processbuilder.js` — final process spawn

---

## Launch Sequence

```
User clicks Play
       │
       ▼
LaunchController.init() registers IPC handlers
       │
       ▼
launcher:launch IPC received
       │
       ├─► 1. Load distribution (DistroAPI)
       │       - Refresh from remote if stale
       │       - Falls back to cached local distribution.json
       │
       ├─► 2. Resolve selected server (HeliosServer object)
       │
       ├─► 3. Java resolution (JavaGuard)
       │       - discoverBestJvmInstallation(dataDir, server.javaVersion)
       │       - If not found: download + extract
       │
       ├─► 4. Full asset repair (FullRepair)
       │       - Runs DistributionIndexProcessor (server modules)
       │       - Runs MojangIndexProcessor (vanilla assets, libraries, client jar)
       │       - Downloads missing/corrupted files via DownloadEngine
       │         (all downloads go through mc-asset:// → RaceManager → P2P or HTTP)
       │
       ├─► 5. Build JVM arguments (LaunchArgumentBuilder)
       │       - Constructs classpath
       │       - Extracts native libraries
       │       - Applies JVM flags, memory settings
       │       (see below for full detail)
       │
       ├─► 6. Resolve mod config (ModConfigResolver)
       │       - Determines enabled/disabled mods per server
       │       - Handles required vs optional mods
       │
       └─► 7. Spawn game process (ProcessBuilder / child_process.spawn)
               - Sends progress updates via IPC to Renderer
               - If launchDetached=true: process runs independently of launcher
               - Stdout/stderr piped to GameCrashHandler
```

---

## LaunchArgumentBuilder

`LaunchArgumentBuilder` produces the final `string[]` passed to `child_process.spawn(javaPath, args)`.

### Constructor Inputs

| Parameter | Type | Description |
|-----------|------|-------------|
| `server` | `HeliosServer` | Server object from distribution |
| `vanillaManifest` | `Object` | Vanilla game version manifest JSON |
| `modManifest` | `Object` | Forge/Fabric version manifest JSON (may equal vanilla for vanilla) |
| `authUser` | `AuthAccount` | Active authenticated user |
| `launcherVersion` | `string` | Current launcher version string |
| `gameDir` | `string` | Absolute path to the per-server instance directory |
| `commonDir` | `string` | Absolute path to the shared common directory |

### Argument Construction: 1.13+ (modern)

Called by `_constructJVMArguments113()`:

1. **Collect JVM args** from `vanillaManifest.arguments.jvm` + `modManifest.arguments.jvm` (if different).
2. **macOS fixes**: Insert `-XstartOnFirstThread` if missing (required for LWJGL on macOS). Add `-Xdock:*` for pre-1.17.
3. **Native library path**: Add `-Djava.library.path=<tempNativePath>` if not already present.
4. **Memory**: `-Xmx<maxRAM>` `-Xms<minRAM>` from ConfigManager (respects per-server overrides).
5. **Additional JNA/Netty paths**: `-Djna.tmpdir`, `-Dorg.lwjgl.system.SharedLibraryExtractPath`, `-Dio.netty.native.workdir`.
6. **Branding**: `-Dminecraft.launcher.brand=FLauncher` `-Dminecraft.launcher.version=<version>`.
7. **GC sanitization**: Remove deprecated `-XX:+UseConcMarkSweepGC` and `-XX:+CMSIncrementalMode`. Add `-XX:+UseG1GC` if no other GC flag present.
8. **Process rules**: Each arg entry with `rules` is evaluated against OS, arch, and feature flags. `is_demo_user` rules are always false. `has_custom_resolution` rules check ConfigManager.
9. **Placeholder substitution**: All `${identifier}` tokens are resolved (see table below).
10. **Deduplication**: `-XstartOnFirstThread` deduplicated for macOS.
11. **Game args**: Same rule/placeholder processing applied to `arguments.game`.
12. **Final order**: `[jvmArgs..., mainClass, gameArgs...]`

### Argument Construction: 1.12 and older (legacy)

Called by `_constructJVMArguments112()`:

1. `-cp <classpath>` (see classpath section below)
2. macOS args prepended
3. Memory flags
4. GC sanitization
5. `-Djava.library.path=<tempNativePath>`
6. `modManifest.mainClass`
7. Forge args via `_resolveForgeArgs()` (splits `minecraftArguments` string, substitutes placeholders)

### Placeholder Substitution Table

| Token | Value |
|-------|-------|
| `${auth_player_name}` | `authUser.displayName.trim()` |
| `${version_name}` | `server.rawServer.id` |
| `${game_directory}` | `gameDir` |
| `${assets_root}` | `commonDir/assets` |
| `${assets_index_name}` | `vanillaManifest.assets` |
| `${auth_uuid}` | `authUser.uuid.trim()` |
| `${auth_access_token}` | `authUser.accessToken` |
| `${user_type}` | `'msa'` (Microsoft) or `'mojang'` |
| `${version_type}` | `vanillaManifest.type` |
| `${resolution_width}` | `ConfigManager.getGameWidth()` |
| `${resolution_height}` | `ConfigManager.getGameHeight()` |
| `${library_directory}` | `commonDir/libraries` |
| `${natives_directory}` | `tempNativePath` |
| `${launcher_name}` | `'FLauncher'` |
| `${launcher_version}` | `launcherVersion` |
| `${classpath}` | Full classpath string (computed lazily) |
| `${clientid}` | `authUser.clientId` or UUID |
| `${auth_xuid}` | `authUser.xuid` or UUID |
| `${quickPlay*}` | → removed (unsupported) |

Arguments referencing unsupported placeholders (any `null` resolution) are removed along with their preceding `--flag` if it starts with `--quickPlay`.

---

## Classpath Construction

`classpathArg(mods, tempNativePath, ...)` builds an ordered array of absolute `.jar` paths:

1. **Version JAR**: `commonDir/versions/<id>/<id>.jar` — omitted for Forge 1.17+ (Forge replaces it).
2. **LiteLoader JAR** (if applicable).
3. **Mojang libraries**: `_resolveMojangLibraries()` — processes `vanillaManifest.libraries`:
   - Skips incompatible OS/arch libraries (rule evaluation).
   - **Extracts natives** (`.dll`/`.so`/`.dylib`) from classifier jars to `tempNativePath` with up to 8 concurrent tasks.
   - Sanitizes artifact paths (collapses `..` to `.` to prevent traversal).
   - After all extractions: removes `META-INF/` and other excluded directories from `tempNativePath`.
4. **Server libraries**: `_resolveServerLibraries()` — from distribution modules of type `ForgeHosted`, `Fabric`, or `Library`.
5. **Mod sub-libraries**: Libraries declared as sub-modules of enabled mods (only if `classpath: true`).

Version-independent Maven IDs are used as dedup keys, so the same library at different versions only appears once (server version wins over vanilla for the same artifact group).

---

## Native Library Extraction

Two extraction paths:

**Legacy format** (`lib.natives` field present):
```
lib.downloads.classifiers[lib.natives[getMojangOS()].replace('${arch}', arch)]
→ extract zip to tempNativePath
```

**Modern format** (library name contains `natives-`):
```
Regex: /.+:natives-([^-]+)(?:-(.+))?/
→ extract arch from name, skip if arch mismatch
→ extract zip to tempNativePath
```

Both respect `lib.extract.exclude` (default: `['META-INF/']`). Exclusions are collected and applied **after** all extractions complete to avoid race conditions.

---

## Crash Handling

`GameCrashHandler.js` monitors stdout/stderr of the game process. On abnormal exit:

1. Parses the last crash log (`crash-reports/` directory).
2. Classifies the crash (OutOfMemoryError, missing library, corrupted asset, driver issue, etc.).
3. Sends `game:crash` IPC event to Renderer with diagnosis + suggested fix.
4. `performLastFix()` (triggered by `ui:action crash-fix`) applies the suggested fix automatically where possible (e.g. clearing broken native cache, resetting mod state).

---

## Process Detachment

When `launchDetached: true` (default):
- Game is spawned with `{ detached: true, stdio: 'ignore' }`.
- `child.unref()` is called — the launcher can be closed without killing the game.

When `launchDetached: false`:
- Game process is a child of the launcher.
- Game exits when the launcher exits (or vice versa).
