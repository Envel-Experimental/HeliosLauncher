const fs = require('fs');
const path = require('path');
const os = require('os');
const { promisify } = require('util');

// We will test the implementation of these replacements
// Note: This test assumes the replacements have been made in the codebase or helper functions.
// Since we are replacing widely used libraries, we'll verify the native behavior wrapper or the new library behavior.

describe('Optimization Replacements Verification', () => {

    // Temp directory for file operations
    const tempDir = path.join(os.tmpdir(), 'start_optimization_test_' + Date.now());

    beforeAll(async () => {
        await fs.promises.mkdir(tempDir, { recursive: true });
    });

    afterAll(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    // 1. fs-extra Replacement Verification
    // We are replacing fs-extra with fs.promises and bespoke helpers.
    describe('fs-extra Replacements', () => {

        test('fs.mkdir({ recursive: true }) replacing ensureDir', async () => {
            const nestedDir = path.join(tempDir, 'a', 'b', 'c');
            await fs.promises.mkdir(nestedDir, { recursive: true });

            const stats = await fs.promises.stat(nestedDir);
            expect(stats.isDirectory()).toBe(true);
        });

        test('fs.rm({ recursive: true, force: true }) replacing remove/emptyDir', async () => {
            const fileToDelete = path.join(tempDir, 'to_delete.txt');
            await fs.promises.writeFile(fileToDelete, 'content');

            await fs.promises.rm(fileToDelete, { force: true });

            await expect(fs.promises.stat(fileToDelete)).rejects.toThrow();
        });

        test('fs.promises.stat replacing pathExists (file)', async () => {
            const fileExists = path.join(tempDir, 'exists.txt');
            await fs.promises.writeFile(fileExists, 'content');

            const exists = await fs.promises.stat(fileExists).then(() => true).catch(() => false);
            expect(exists).toBe(true);

            const notExists = path.join(tempDir, 'not_exists.txt');
            const exists2 = await fs.promises.stat(notExists).then(() => true).catch(() => false);
            expect(exists2).toBe(false);
        });

    });

    // 3. toml Replacement Verification
    // Replacing 'toml' with 'smol-toml'
    describe('toml Replacement (smol-toml)', () => {
        let toml;
        try {
            toml = require('smol-toml');
        } catch (e) {
            console.warn('@iarna/toml not installed, skipping specific toml tests');
        }

        if (toml && toml.parse) {
            test('should parse TOML correctly', () => {
                const tomlStr = `
                title = "TOML Example"
                [owner]
                name = "Tom Preston-Werner"
                `;
                const expected = {
                    title: "TOML Example",
                    owner: {
                        name: "Tom Preston-Werner"
                    }
                };

                // Note: @iarna/toml uses .parse just like the old library if consistent with TOML spec
                const result = toml.parse(tomlStr);
                // Simple check for nested property
                expect(result.owner.name).toBe("Tom Preston-Werner");
            });
        }
    });

});
