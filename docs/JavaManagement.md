# Java Management

`app/assets/js/core/java/JavaGuard.js` handles all Java-related operations: discovery, version validation, download, and extraction.

---

## Overview

The launcher manages its own JRE/JDK. When a game server specifies a Java version requirement, `JavaGuard` either finds a compatible local installation or downloads one automatically.

---

## Discovery Pipeline

`discoverBestJvmInstallation(dataDir, semverRange)` is the main entry point.

```
discoverBestJvmInstallation(dataDir, semverRange)
    │
    ├─► getValidatableJavaPaths(dataDir)
    │       │
    │       ├─ Windows: EnvironmentBasedJavaDiscoverer (JAVA_HOME, JRE_HOME, JDK_HOME)
    │       │           DirectoryBasedJavaDiscoverer (Program Files\*, all drives C–Z)
    │       │           Win32RegistryJavaDiscoverer (HKLM SOFTWARE\JavaSoft\*)
    │       │
    │       ├─ macOS:   EnvironmentBasedJavaDiscoverer
    │       │           DirectoryBasedJavaDiscoverer (/Library/Java/JavaVirtualMachines)
    │       │           PathBasedJavaDiscoverer (/Library/Internet Plug-Ins/...)
    │       │
    │       └─ Linux:   EnvironmentBasedJavaDiscoverer
    │                   DirectoryBasedJavaDiscoverer (/usr/lib/jvm)
    │
    ├─► resolveJvmSettings(paths)
    │       Runs `java -XshowSettings:properties -version` for each candidate.
    │       Parses stdout for: java.version, java.vendor, sun.arch.data.model, os.arch
    │
    ├─► filterApplicableJavaPaths(resolvedSettings, semverRange)
    │       Filters to 64-bit JVMs only.
    │       On arm64 host: requires os.arch == 'aarch64' or 'arm64'.
    │       Applies semver range from distribution (e.g. '>=17.0.0 <18').
    │
    └─► rankApplicableJvms(jvmDetails)
            Sort order: higher major → higher minor → higher patch → prefers 'jdk' in path.
            Returns top candidate.
```

The **launcher runtime directory** (`%APPDATA%\.foxford\runtime\{arch}\`) is always included in the discovery paths, so previously downloaded JDKs are found automatically.

---

## Launchers Runtime Directory

```
%APPDATA%\.foxford\runtime\
    x64\
        OpenJDK21U-jdk_x64_windows_hotspot_21.0.3_9.zip   ← downloaded archive
        jdk-21.0.3+9\                                       ← extracted JDK
            bin\
                java.exe
                javaw.exe
    arm64\
        ...
```

---

## Download: `latestOpenJDK(major, dataDir, distribution?)`

When no compatible local JVM is found, `latestOpenJDK` races multiple sources simultaneously:

```
latestOpenJDK(major)
    │
    ├─► Mirror tasks (parallel): for each mirror with java_manifest
    │       loadJavaMirrorManifest(mirror.java_manifest)
    │           → fetchWithTimeout(url)
    │           → verify Ed25519 signature (.sig file)
    │           → cache manifest in memory
    │       Extract entry for { os, arch, major }
    │
    └─► Official task (parallel):
            if major >= 17:
                latestGraalVM(major)       # try Liberica NIK first, fallback GitHub
            else:
                latestAdoptium(major)      # Eclipse Temurin via Adoptium API
```

`Promise.any()` returns whichever source resolves first. If mirrors are faster (cached), they win. If all fail, returns `null` (caller shows error UI).

### Supported Distributions

| Distribution | API | Notes |
|-------------|-----|-------|
| `temurin` (default for <17) | Adoptium v3 API | Returns ZIP (Windows) or tar.gz |
| `graalvm` (default for ≥17) | Liberica NIK API → GitHub GraalVM CE releases | NIK = GraalVM + native image |
| `corretto` | Amazon Corretto direct URL (HEAD redirect) | No checksum returned |
| `installer` | Adoptium MSI (Windows only) | Runs `msiexec /i /passive` |
| Custom mirror | `mirror.java_manifest` JSON | Verified via Ed25519 `.sig` file |

### Mirror Manifest Format

Served at `mirror.java_manifest` URL (e.g. `https://f-launcher.ru/fox/new/mirror/java/manifest.json`):

```json
{
  "windows": {
    "x64": {
      "21": { "url": "...", "size": 12345678, "name": "jdk-21.zip", "sha1": "abc..." },
      "installer": { "url": "...", "size": 9876543, "name": "jdk-21.msi", "sha1": "def..." }
    },
    "aarch64": { ... }
  },
  "mac": { ... },
  "linux": { ... }
}
```

The manifest must have a corresponding `.sig` file (same URL + `.sig`) containing a hex-encoded Ed25519 signature over the raw manifest bytes. Invalid or missing signatures cause the mirror to be rejected.

---

## Extraction

```js
extractJdk(archivePath)
```

- `.zip` → `extractZip()` (streaming, reads first entry to determine root dir)
- `.tar.gz` → `extractTarGz()` (streaming, reads first header)
- Returns the path to the extracted `javaw.exe` / `java` binary.

After extraction, the launcher records the JVM path in config and deletes the archive.

---

## Installation (Windows MSI)

```js
runInstaller(installerPath)
```

On Windows: `execFile('msiexec', ['/i', path, '/passive'])` — silent install, shows progress bar but no user prompts.

On macOS/Linux: `shell.openPath(installerPath)` — opens the installer for the user to run manually.

---

## Version Parsing

Two parsers handle the two historical Java version formats:

**Legacy (Java 8 and below):** `1.8.0_362` → `{ major: 8, minor: 0, patch: 362 }`

**Modern (Java 9+):** `21.0.3` → `{ major: 21, minor: 0, patch: 3 }`

Version comparison uses `semver.satisfies()` after converting to `"major.minor.patch"` string.

---

## Validation

`validateSelectedJvm(path, semverRange)` validates a user-specified JVM path:
1. Checks the binary exists and is accessible.
2. Runs `-XshowSettings:properties -version` to extract version metadata.
3. Filters against the required semver range.
4. Returns the JVM details object, or `null` if invalid.

This is called when the user manually sets a custom Java path in Settings.
