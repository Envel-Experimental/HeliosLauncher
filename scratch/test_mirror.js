async function test() {
    const url = 'https://mirror.nikita.best/metadata/version_manifest_v2.json';
    const testUrl = url + '?t=' + Date.now();
    console.log('Testing URL:', testUrl);
    try {
        const res = await fetch(testUrl, {
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 HeliosLauncher/1.0'
            }
        });
        console.log('Status:', res.status);
        console.log('OK:', res.ok);
    } catch (e) {
        console.error('Error:', e.message);
    }
}

test();
