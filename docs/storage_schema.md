# Storage Schema & Data Classification

This document details the file storage architecture, data sources, and security classification for the Launcher.

## 🟢 Data Legend
| Status | Class | Origin | Description |
| :--- | :--- | :--- | :--- |
| 🛡️ | **Sensitive** | Internet Only | Critical private data (configs, logs, tokens). No P2P. |
| 📦 | **Public** | P2P + Internet | Game assets, libraries, runtimes. Fully shareable. |
| 📝 | **Mutable** | Local Only | User-installed mods, options, and save files. No P2P. |
| 📡 | **Control** | Internet Only | Bootstrap, distribution indices, version manifests. |

---

## 📂 Directory Structure

```text
.foxford/
├── 📡 config.json              # Main launcher settings (RAM, login paths)
├── 📡 distribution.json        # Manifest of servers/files (HTTPS only)
├── 🛡️ config.json              # App data (Login tokens - CRITICAL SENSITIVITY)
├── 🛡️ peers.json               # P2P peer cache (Connection info)
│
├── 📦 common/                  # Global Data Cache (Read-Only Proxy)
│   ├── 📡 assets/indexes/      # Asset Index JSONs (Minecraft metadata)
│   ├── 📦 assets/objects/      # Sharded assets (Sounds, Textures, Lang)
│   ├── 📡 assets/log_configs/  # Launch XMLs
│   ├── 📦 libraries/           # Maven libraries (.jar, .dll)
│   └── 📦 runtime/             # Game JREs (java.exe, javaw.exe)
│
├── 📝 instances/               # User-specific Environment
│   └── [server_id]/
│       ├── 📝 options.txt      # User keybindings/settings (Never Overwrite)
│       ├── 📦 mods/            # Instance mods (May be P2P if in distro)
│       ├── 📝 config/          # Mod settings (User modified)
│       └── 🛡️ logs/            # Crash reports and session logs
│
└── 📦 icons/                   # Server brand thumbnails
```

---

## 🛠️ Data Sourcing Matrix

| File Type | Protocol | P2P Priority | Seeder Logic |
| :--- | :--- | :--- | :--- |
| **Distribution Index** | HTTPS | ❌ Blocked | Never distributed via P2P. |
| **Client Jar** | P2P/HTTPS | 🚀 High | Served from `versions/`. |
| **Asset Objects** | P2P/HTTPS | 🚀 High | Served from `common/assets/objects/`. |
| **Libraries** | P2P/HTTPS | 🚀 High | Served from `common/libraries/`. |
| **Java Runtime** | P2P/HTTPS | 🚀 High | Served from `common/runtime/`. |
| **Instance Configs** | Local | ❌ Blocked | Blocked by Security Whitelist. |
| **Private Tokens** | Local | ❌ Blocked | Blacklisted by name (`config.json`). |

---

## 🔒 Security & Fair Usage Logic

### 1. Seeder Protection (The "Soft Ban")
- **Token Bucket**: Every IP has a 5GB burst credit limit.
- **Regeneration**: Credits recover at **2MB/s**.
- **Action**: If credits empty, seeder returns `MSG_ERROR: Busy`.

### 2. File Path Resolution
The client requests files using **Physical Relative Paths** (e.g., `common/assets/objects/35/3503...`).
- **Seeder Check**: The seeder verifies `path.isAbsolute(rel) === false` and `rel.startsWith('..') === false`.
- **Whitelist**: Only `assets`, `libraries`, `versions`, `common`, `icons`, `minecraft` are allowed.
- **Blacklist**: Explicitly blocks `config.json`, `distribution.json`, `peers.json`, `version_manifest_v2.json`.

### 3. Mutual Trust
- **Validation**: Every file received via P2P is validated by its **Hash (MD5/SHA1)** before use.
- **Corruption Fix**: If P2P fails validation twice, the launcher falls back to **HTTPS**.
