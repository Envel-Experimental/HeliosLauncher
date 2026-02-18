# Staged Rollouts for Launcher Updates

The launcher utilizes `electron-updater` which has built-in support for **Staged Rollouts**. This allows you to release an update to only a percentage of your user base (e.g., 10%) and gradually increase it to ensure stability.

## How It Works

1.  **Server-Side Control**: The rollout percentage is controlled entirely by the `latest.yml` (Windows), `latest-mac.yml` (macOS), or `latest-linux.yml` (Linux) files on your update server.
2.  **Client-Side Logic**: When the launcher checks for updates, it reads the `stagingPercentage` from the YAML file.
3.  **Deterministic**: The launcher calculates a deterministic value based on the user's Machine ID. This means a user will consistently fall into the same "bucket" relative to the percentage.
    -   If their calculated value is `< stagingPercentage`, they get the update.
    -   If not, they don't (until you increase the percentage).

## Implementation Guide

To implement a staged rollout for a new version (e.g., `2.5.0`), follow these steps during your release process:

### 1. Build the Update
Run your standard build command to generate the artifacts (`.exe`, `.AppImage`, etc.) and the `latest.yml` files.

```bash
npm run dist
```

### 2. Configure Staging (Server-Side)
Before uploading the `latest.yml` file to your server, open it and add the `stagingPercentage` field.

**Example `latest.yml` for 10% Rollout:**
```yaml
version: 2.5.0
files:
  - url: FLauncher-Setup-2.5.0.exe
    sha512: ...
    size: ...
path: FLauncher-Setup-2.5.0.exe
sha512: ...
releaseDate: '2026-02-18T10:00:00.000Z'
stagingPercentage: 10  # <--- ADD THIS LINE
```

### 3. Upload
Upload the modified `latest.yml` and the update files to your update server.

### 4. Monitor and Expand
*   **Initial Phase**: Only 10% of users will download the update.
*   **Expansion**: If no critical bugs are reported, edit the `latest.yml` file **directly on the server** (or re-upload) with an increased percentage.
    -   Change `stagingPercentage: 10` -> `stagingPercentage: 50`
    -   Change `stagingPercentage: 50` -> `stagingPercentage: 100` (or simply remove the line for 100%).

## Important Notes

*   **No Code Changes Required**: The client capability is present in `electron-updater`.
*   **`allowPrerelease` Bypass**: Staged rollouts apply to **stable** releases. If a user has "Allow Prereleases" enabled, they might bypass staging.
*   **Force Update**: Users who manually click "Check for Updates" might still be subject to the staging percentage depending on implementation.

## Rollback Strategy
If you discover a bug:
1.  **Halt**: Stop increasing the percentage.
2.  **Revert**: Upload a newer version number (e.g., `2.5.1`) containing the stable code, or remove the buggy version entry from `latest.yml`.
