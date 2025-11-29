# Distribution Logic Documentation

This document explains the High-Availability Multi-Mirror Downloading system used by FLauncher.

## Overview

The launcher retrieves its main configuration file (`distribution.json`) and other assets from a set of mirror servers. This ensures the launcher continues to work even if one server goes down.

## Mirror Selection (Smart Selection)

At startup, the `MirrorManager` performs a "race" to determine the best mirror:
1.  It sends a lightweight HTTP `HEAD` request to `distribution.json` on all known mirrors simultaneously.
2.  The first server to respond with a 200 OK status is selected as the **Primary Mirror** for the session.
3.  If all checks fail, it defaults to the first mirror in the list.

## Failover System

During the download of the distribution index:
1.  If the download fails (due to timeout, network error, or HTTP 5xx), the `DistroManager` catches the error.
2.  It automatically switches to the **next** mirror in the list.
3.  It retries the download immediately.
4.  This process repeats until a successful download occurs or all mirrors have been tried.

## Dynamic Remote Configuration

The launcher can update its list of mirrors remotely without requiring a new application update.

### `update-distro.json`

The launcher periodically checks the root of the active mirror for a file named `update-distro.json`.

**Structure:**
```json
{
  "mirrors": [
    "https://f-launcher.ru/fox/new/",
    "https://backup-mirror.example.com/repo/",
    "https://another-mirror.net/files/"
  ]
}
```

*   **mirrors**: An array of base URLs strings. Each URL must end with a slash if it points to a directory.

### Process
1.  **Fetch**: The launcher downloads `update-distro.json` in the background.
2.  **Validate**: It strictly validates that the JSON contains a `mirrors` array of valid URL strings. Malformed files are ignored.
3.  **Compare**: It compares the downloaded configuration with the locally saved one. If they are identical, no action is taken.
4.  **Persist**: If new, it saves the file to `distro-config.json` in the user's data directory.
5.  **Merge**: On the next launch, these saved mirrors are merged with the hardcoded default mirrors.

## Adding New Mirrors

To add a new mirror:
1.  Upload the `distribution.json` and assets to the new server.
2.  Create or update `update-distro.json` on your primary server.
3.  Add the new mirror URL to the `mirrors` array in `update-distro.json`.
4.  The launcher will pick up the change on the next successful launch.
