
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { fetchJson } = require('../app/assets/js/core/network');
const { extractZip, calculateHash } = require('../app/assets/js/core/common');

test('Migration Smoke Tests', async (t) => {

    await t.test('UUID Generation', () => {
        const id = uuidv4();
        assert.ok(id, 'UUID should be generated');
        assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, 'UUID format valid');
    });

    await t.test('Network Layer (fetch replacement)', async () => {
        // Mocking a request is hard without a server, so we'll try a safe public URL or skip if offline
        // But the environment usually has internet.
        // Let's try fetching a small JSON from a reliable source or just handle failure gracefully if offline
        try {
            const res = await fetchJson('https://httpbin.org/json', { timeout: { request: 5000 } });
            assert.strictEqual(res.statusCode, 200);
            assert.ok(res.body.slideshow, 'Should receive JSON body');
        } catch (err) {
            if (err.code === 'ENOTFOUND' || err.code === 'ETIMEDOUT') {
                console.warn('Network test skipped due to connectivity issues');
            } else {
                throw err;
            }
        }
    });

    await t.test('File System Operations', async () => {
        const testDir = path.join(__dirname, 'fs_test');
        const testFile = path.join(testDir, 'test.txt');

        // Cleanup first
        await fs.promises.rm(testDir, { recursive: true, force: true }).catch(() => {});

        // Test mkdir
        await fs.promises.mkdir(testDir, { recursive: true });
        assert.ok(fs.existsSync(testDir), 'Directory created');

        // Test write
        await fs.promises.writeFile(testFile, 'Hello World');
        assert.ok(fs.existsSync(testFile), 'File created');

        // Test read
        const content = await fs.promises.readFile(testFile, 'utf8');
        assert.strictEqual(content, 'Hello World');

        // Test hash
        const hash = await calculateHash(testFile, 'sha1');
        assert.strictEqual(hash, '0a4d55a8d778e5022fab701977c5d840bbc486d0', 'SHA1 hash correct');

        // Cleanup
        await fs.promises.rm(testDir, { recursive: true, force: true });
        assert.ok(!fs.existsSync(testDir), 'Directory removed');
    });

});
