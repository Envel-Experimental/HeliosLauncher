# Testing

FLauncher uses **Jest** for unit and integration tests and **Playwright** for end-to-end and smoke tests.

---

## Test Stack

| Tool | Version | Purpose |
|------|---------|---------|
| Jest | ^30 | Unit, integration, coverage |
| Playwright | ^1.58 | E2E, smoke, performance |
| MSW (Mock Service Worker) | ^2 | HTTP mock server for download/API tests |
| jest-environment-jsdom | ^30 | DOM environment for renderer-side tests |

---

## Directory Layout

```
tests/
├── unit/
│   └── network/
│       └── PeerHandler.fuzz.test.js   ← Property/fuzz tests for P2P security
├── integration/
│   └── AutoUpdateLive.test.js         ← Live GitHub API auto-update test
├── performance/
│   └── (Playwright perf tests)
├── jest.setup.js                       ← Global setup: MSW server, Electron mocks
├── test-utils.js                       ← Shared fixtures, mock config, test helpers
├── distribution.spec.js                ← Distribution JSON parsing + schema validation
├── download.spec.js                    ← DownloadEngine with MSW mock CDN
├── settings_boundaries.spec.js         ← Setting value boundary tests (RAM, resolution, etc.)
├── settings_persistence.spec.js        ← Config save → load roundtrip
├── settings_validation.spec.js         ← Input validation rules
├── smoke.spec.js                       ← Playwright: app starts and reaches landing
├── e2e.spec.js                         ← Playwright: full user journey
├── user_journey.spec.js                ← Launch flow simulation
└── diagnostic.spec.js                  ← System info + connectivity
```

---

## Running Tests

```bash
# Full test suite (lint + async check + jest + smoke)
npm test

# Jest only (all suites)
npx jest

# Unit tests only
npm run test:unit          # → jest tests/unit

# Integration tests only
npm run test:integration   # → jest tests/integration

# Coverage report
npm run test:coverage      # → jest --coverage → coverage/

# Async/blocking call audit
npm run test:async         # → node scripts/check_async.js

# Playwright smoke
npm run test:smoke         # → playwright test tests/smoke.spec.js

# Playwright E2E
npm run test:e2e           # → playwright test tests/e2e.spec.js

# Performance
npm run test:performance   # → playwright test tests/performance
```

---

## Jest Configuration

`jest.config.js`:

```js
{
  testEnvironment: 'node',    // default
  setupFilesAfterEach: ['tests/jest.setup.js'],
  moduleNameMapper: {
    // Electron mock (electron is not available in Jest)
    '^electron$': '<rootDir>/app/assets/js/mocks/electron.mock.js'
  },
  transform: {
    // babel-jest for ESM dependencies (msw, etc.)
    '^.+\\.m?js$': 'babel-jest'
  },
  collectCoverageFrom: [
    'app/assets/js/core/**/*.js',
    'network/**/*.js',
    '!**/node_modules/**'
  ]
}
```

Tests that need the DOM (renderer-side) specify `@jest-environment jsdom` in a file-level docblock.

---

## Mocking Electron

`app/assets/js/mocks/` contains mock implementations:

- **`electron.mock.js`**: Stubs `ipcRenderer`, `ipcMain`, `app`, `BrowserWindow`, `shell`. Used automatically by Jest via `moduleNameMapper`.

For tests that need P2P or network behavior, MSW intercepts `fetch()` calls.

---

## MSW Setup

`tests/jest.setup.js` starts an MSW server before all tests:

```js
import { setupServer } from 'msw/node'
const server = setupServer(...handlers)
beforeAll(() => server.listen())
afterEach(() => server.resetHandlers())
afterAll(() => server.close())
```

Handlers are defined per test file using `http.get()` / `http.post()` from MSW v2.

---

## Writing New Unit Tests

```js
// tests/unit/my-module.test.js

const MyModule = require('../../app/assets/js/core/my-module')

describe('MyModule', () => {
    beforeEach(() => {
        jest.clearAllMocks()
    })

    test('does something specific', async () => {
        const result = await MyModule.doSomething('input')
        expect(result).toBe('expected')
    })
})
```

If your module uses ConfigManager, mock it:
```js
jest.mock('../../app/assets/js/core/configmanager', () => ({
    getLauncherDirectory: jest.fn().mockResolvedValue('/tmp/test-launcher'),
    getMaxRAM: jest.fn().mockReturnValue('4G'),
    // ... other methods used by the module
}))
```

---

## Writing New Playwright Tests

```js
// tests/my-flow.spec.js
const { test, expect } = require('@playwright/test')
const { _electron: electron } = require('playwright')

test('user can reach settings', async () => {
    const app = await electron.launch({ args: ['.'] })
    const window = await app.firstWindow()
    
    await window.waitForSelector('#settingsButton')
    await window.click('#settingsButton')
    await expect(window.locator('#settingsPanel')).toBeVisible()
    
    await app.close()
})
```

Playwright tests require the app to be runnable (`npm start` works). They do not use a bundled build by default.

---

## Async Audit

`scripts/check_async.js` statically analyzes the codebase for:
- `ipcRenderer.sendSync()` calls in async-capable contexts
- `fs.readFileSync()` in hot paths
- Other potentially blocking operations

Run with `npm run test:async`. Fails CI if blocking calls are detected in restricted paths.

---

## Coverage Targets

Current coverage is collected for:
- `app/assets/js/core/**` — all renderer/shared business logic
- `network/**` — P2P engine, RaceManager, MirrorManager

Coverage report: `coverage/lcov-report/index.html` after `npm run test:coverage`.
