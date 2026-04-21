const url = 'https://f-launcher.ru/fox/new/mirror/metadata/version_manifest_v2.json';

console.log('Testing URL:', url);
fetch(url, {
    headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 HeliosLauncher/1.0'
    }
})
.then(async res => {
    console.log('Status:', res.status, res.statusText);
    if (res.ok) {
        const text = await res.text();
        console.log('Content length:', text.length);
        console.log('Preview:', text.substring(0, 100));
    } else {
        console.error('Failed with status:', res.status);
    }
})
.catch(err => {
    console.error('Fetch Error:', err);
});
