const { MOJANG_MIRRORS, DISTRO_PUB_KEYS } = require('../../../network/config');
const { verifyDistribution } = require('../../../app/assets/js/core/util/SignatureUtils');

/**
 * Mirror Health Check Test
 * Verifies that all configured mirrors are accessible and provide valid Ed25519 signatures
 * for their manifests.
 */
describe('Mirror Health Check', () => {
    
    if (!MOJANG_MIRRORS || MOJANG_MIRRORS.length === 0) {
        test('No mirrors configured', () => {
            console.warn('No mirrors found in config.js');
        });
        return;
    }

    MOJANG_MIRRORS.forEach(mirror => {
        describe(`Mirror: ${mirror.name}`, () => {
            
            const checkManifest = (label, url) => {
                if (!url) return;

                test(`${label} should be accessible and signed`, async () => {
                    // 1. Fetch Manifest
                    const res = await fetch(url, { cache: 'no-store' });
                    
                    if (res.status === 404) {
                        console.warn(`[SKIP] ${label} is missing (404) on mirror ${mirror.name}. This might be expected for some mirrors.`);
                        return;
                    }

                    expect(res.status).toBe(200);
                    const rawBuffer = Buffer.from(await res.arrayBuffer());
                    
                    // 2. Fetch Signature
                    const sigRes = await fetch(url + '.sig', { cache: 'no-store' });
                    if (sigRes.status === 404) {
                        throw new Error(`Signature file (.sig) is missing for ${label} on ${mirror.name}. This is a SECURITY RISK.`);
                    }
                    expect(sigRes.status).toBe(200);
                    const signatureHex = (await sigRes.text()).trim();
                    
                    // 3. Verify Signature
                    const isValid = verifyDistribution({
                        dataHex: rawBuffer.toString('hex'),
                        signatureHex: signatureHex,
                        trustedKeys: DISTRO_PUB_KEYS
                    });
                    
                    expect(isValid).toBe(true);
                }, 20000); // 20s timeout for network requests
            };

            checkManifest('Version Manifest', mirror.version_manifest);
            checkManifest('Java Manifest', mirror.java_manifest);
            checkManifest('Distribution Index', mirror.distribution);

            if (mirror.assets) {
                test('Assets endpoint should be reachable', async () => {
                    const res = await fetch(mirror.assets, { method: 'HEAD' });
                    // Some servers might return 403 on root, but we just check if it's not a connection error
                    expect(res.status).toBeLessThan(500);
                });
            }

            if (mirror.libraries) {
                test('Libraries endpoint should be reachable', async () => {
                    const res = await fetch(mirror.libraries, { method: 'HEAD' });
                    expect(res.status).toBeLessThan(500);
                });
            }
        });
    });
});
