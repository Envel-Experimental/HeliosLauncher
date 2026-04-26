# Analytics System

The launcher includes a modular analytics service located at `app/assets/js/core/util/Analytics.js`.

## Current Status
- **Status**: 🟢 ENABLED
- **Implementation**: PostHog active.
- **Data Collection**: Active in `landing.js`.

## Tracked Events

### Game Launch Started
Triggered when the user clicks the "Launch" button and Java validation is complete.
- **serverId**: Internal ID of the selected server.
- **server_name**: Human-readable name of the server.
- **mc_version**: Minecraft version (e.g., 1.20.1).
- **module_count**: Number of modules/mods being loaded.
- **jvm_version**: Validated Java version string.
- **account_type**: 'Microsoft' or 'Offline'.

### Launcher Loaded
Triggered when the renderer bundle is initialized.
- **os_platform**: win32, linux, etc.
- **launcher_version**: Current version from package.json.
- **ram_total**: Total system RAM.

## Enabling Analytics
To enable tracking, set `this.enabled = true` in `app/assets/js/core/util/Analytics.js` and provide a valid API key.
