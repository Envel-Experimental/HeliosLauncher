# Migration Specs: Helios Core to Local App Structure

## Overview
The `helios-core` library has been migrated from an external npm dependency/submodule to a local module structure within `app/assets/js/core`. This migration modernizes the codebase by converting TypeScript to ES6 JavaScript, replacing deprecated dependencies, and integrating runtime patches directly into the source.

## Structure
- `app/assets/js/core/network.js`: New network layer replacing `got`. Implements a `fetch` wrapper.
- `app/assets/js/core/common.js`: Aggregates utility functions from `MavenUtil`, `MojangUtils`, `FileUtils`, and `LoggerUtil`.
- `app/assets/js/core/launcher.js`: Contains the main business logic classes: `DistributionAPI`, `HeliosDistribution`, `HeliosServer`, `HeliosModule`.

## Key Changes

### Dependency Replacements
| Original | Replacement | Reason |
| :--- | :--- | :--- |
| `got` | `fetch` (Native) | Modernization, removal of heavy dependency. |
| `bluebird` | Native `Promise` | Standard ES6+ support. |
| `rimraf` | `fs.rm` | Native Node.js capability. |
| `mkdirp` | `fs.mkdir` | Native Node.js capability. |
| `fs-extra` | `fs.promises` | Reduced dependency overhead (partial replacement). |

### Preserved Logic & Hacks
1. **Distribution Retry Logic**: The runtime patch from `distromanager.js` that retries `getDistribution` on failure has been integrated into `DistributionAPI.getDistribution()`.
2. **Remote Failure Flag**: The `_remoteFailed` flag logic has been integrated into `DistributionAPI.pullRemote()`.
3. **Maven Parsing**: The specific Regex for Maven identifiers in `MavenUtil` has been preserved to ensure compatibility with existing server configurations.
4. **Java Version Logic**: Hardcoded Java version rules (e.g., Java 21 for 1.20.5+) have been preserved in `HeliosServer`.

### `got` to `fetch` Transition
The `network.js` module exports a `fetchJson` function that mimics `got`'s behavior:
- Automatic JSON parsing with `responseType: 'json'`.
- Timeout handling (mapped to `AbortSignal`).
- Error classification (`HTTPError`, `TimeoutError`, `ParseError`) to maintain compatibility with existing error handling logic in `RestResponse`.

## Testing
A smoke test suite is available in `tests/migration_smoke.test.js` to validate:
- UUID generation.
- Network requests (via the new `fetch` wrapper).
- File system operations (hashing, read/write/delete).
