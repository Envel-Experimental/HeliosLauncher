# End-to-End Testing Guide

This document describes the E2E testing infrastructure for HeliosLauncher, built with [Playwright](https://playwright.dev/).

## Overview

The E2E tests are designed to run the application in an isolated environment, bypassing complex startup hurdles and verifying core functionality like settings persistence, account management, and launch processes.

## Prerequisites

- Node.js (>= 20.x)
- Playwright dependencies (installed via `npm install`)
- Windows environment (current scripts are optimized for Windows)

## Running Tests

To run the full E2E suite:

```powershell
npm run test:e2e
```

To run the smoke test (basic launch check):

```powershell
npm run test:smoke
```

## Infrastructure

### Test Utilities ([test-utils.js](../tests/test-utils.js))

- **`launchApp()`**: Handles the Electron launch process with isolated data directories.
- **`setupDummyConfig()`**: Injects a pre-configured `config.json` into the temporary test directory to ensure the app starts in a deterministic state (e.g., already logged in).
- **`handleInitialOverlays()`**: Automatically dismisses common startup screens like RAM warnings, P2P prompts, and the Welcome screen.
- **`openSettings()` / `switchSettingsTab()`**: Helpers for navigating the app's internal UI.

### Test Environment Lifecycle

The tests use a temporary directory named `temp_test_user_data` in the project root. This directory is:
1. Created/Reset before tests run.
2. Injected with a dummy configuration.
3. Cleaned up after tests finish (if successful).

## Troubleshooting

### Timeouts
If the app takes too long to launch, increase the timeout in `e2e.spec.js`:
```javascript
test.setTimeout(240000); // Default is 4 minutes
```

### Resource busy (EBUSY)
If you get `EBUSY` errors when starting tests, ensure no other instances of HeliosLauncher or previous test runs are still active in the background.

### UI Changes
If the UI is refactored, you may need to update the selectors in `test-utils.js` or `e2e.spec.js`. Use the Playwright [Inspector](https://playwright.dev/docs/inspector) to find new selectors.
