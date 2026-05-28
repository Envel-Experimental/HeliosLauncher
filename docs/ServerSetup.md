# Server Setup

How to add a new game server to the launcher.

---

## Overview

The launcher is driven entirely by `distribution.json`. To add a server, you edit the distribution, sign it, and publish it. No code changes needed.

---

## Step 1: Prepare Server Modules

Collect all files the launcher needs to download for this server:

- Game loader JAR (Forge/Fabric)
- Mod files
- Config files
- Resource packs (if any)

For each file you need:
- The file itself (to compute MD5 and size)
- A stable download URL

---

## Step 2: Compute File Metadata

For each file:

```bash
# MD5 hash
md5sum mymod-1.0.0.jar
# → abc123def456... mymod-1.0.0.jar

# File size in bytes
wc -c < mymod-1.0.0.jar
# → 12345678
```

Or with PowerShell:
```powershell
(Get-FileHash mymod-1.0.0.jar -Algorithm MD5).Hash.ToLower()
(Get-Item mymod-1.0.0.jar).Length
```

---

## Step 3: Write the Server Entry

Add a server object to `distribution.json` under `"servers"`:

```json
{
  "id": "my-server-1.20",
  "name": "My Server",
  "description": "A brief description",
  "icon": "https://cdn.example.com/server-icon.png",
  "version": "1.0.0",
  "address": "play.example.com:25565",
  "minecraftVersion": "1.20.1",
  "mainServer": false,
  "autoconnect": false,
  "javaOptions": {
    "supported": ">=21.0.0 <22",
    "suggestedMajor": 21,
    "distribution": "graalvm"
  },
  "rollout": {
    "percent": 100
  },
  "modules": [
    {
      "id": "net.minecraftforge:forge:47.3.0@jar",
      "name": "Forge 47.3.0",
      "type": "ForgeHosted",
      "artifact": {
        "size": 8765432,
        "MD5": "abc123def456abc123def456abc123de",
        "path": "net/minecraftforge/forge/47.3.0/forge-47.3.0.jar",
        "url": "https://cdn.example.com/forge-47.3.0.jar"
      },
      "classpath": true,
      "required": { "value": true, "def": true },
      "subModules": []
    },
    {
      "id": "com.example:mymod:1.0.0@jar",
      "name": "My Mod",
      "type": "ForgeMod",
      "artifact": {
        "size": 12345678,
        "MD5": "def456abc123def456abc123def456ab",
        "path": "mods/mymod-1.0.0.jar",
        "url": "https://cdn.example.com/mymod-1.0.0.jar"
      },
      "required": { "value": false, "def": true }
    }
  ]
}
```

### Key Fields

| Field | Notes |
|-------|-------|
| `id` | Must be unique across all servers. Used as config key. |
| `mainServer` | Only one server should have `true`. Others get `false` automatically. |
| `javaOptions.supported` | semver range. The launcher validates the available JVM against this. |
| `javaOptions.suggestedMajor` | Downloaded if no valid JVM found locally. |
| `module.id` | Maven coordinate: `group:artifact:version@ext` |
| `module.type` | `ForgeHosted`, `Fabric`, `ForgeMod`, `FabricMod`, `Library`, `File` |
| `module.artifact.path` | Relative path from `commonDir/libraries` (for libs) or instance dir (for mods/files) |
| `module.required.value` | If `false`, user can toggle in Settings |
| `module.required.def` | Default enabled state for optional mods |

---

## Step 4: Update Timestamp and Version

Always update these fields before publishing:

```json
{
  "version": "1.1.0",
  "timestamp": "2024-06-01T12:00:00.000Z",
  ...
}
```

`timestamp` must be **newer** than the currently live distribution, or the anti-replay check will reject it.

---

## Step 5: Sign the Distribution

```bash
# Sign (Python example)
python sign_distro.py distribution.json distro_private.pem distribution.json.sig
```

See [signing_guide.md](./signing_guide.md) for full signing instructions.

---

## Step 6: Publish

Upload both files to your CDN/server:

```
https://f-launcher.ru/fox/new/distribution.json
https://f-launcher.ru/fox/new/distribution.json.sig
```

Both files must be served with appropriate CORS headers if accessed cross-origin.

---

## Module Path Conventions

### Libraries (ForgeHosted, Fabric, Library)
Path is relative to `<commonDir>/libraries/`. Use Maven-style paths:
```
net/minecraftforge/forge/47.3.0/forge-47.3.0.jar
```

### Mods (ForgeMod, FabricMod)
Path is relative to the instance directory: `mods/<filename>.jar`

### Config files (File)
Path is relative to the instance directory: `config/<filename>.toml`

### Sub-modules
Sub-modules are dependencies of a module (e.g. Forge's own bundled libraries). They follow the same schema and are placed on the classpath if `classpath: true`.

---

## Staging a Rollout

To release to a subset of users first:

```json
"rollout": { "percent": 10 }
```

Increase gradually:
- Day 1: 10%
- Day 3: 25%
- Day 7: 50%
- Day 14: 100%

Each change requires a new signed distribution with an updated timestamp. See [staged_rollouts.md](./staged_rollouts.md).

---

## Testing Locally

1. Create `distribution_dev.json` in `%APPDATA%\.foxford\` (or platform equivalent).
2. Run the launcher from source (`npm start`).
3. It will load `distribution_dev.json` instead of fetching from the remote.

The dev distribution does not need a valid signature — signature checking is skipped when the launcher is running unpackaged.
