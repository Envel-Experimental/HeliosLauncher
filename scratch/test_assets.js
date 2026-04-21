const urls = [
    'https://f-launcher.ru/fox/new/mirror/assets/objects/ca/ca7cd01fd13898a03336510f8b0dd4074ecb5c1a',
    'https://f-launcher.ru/fox/new/mirror/assets/objects/25/2589440360a753366983702bd4c6e8f9c7aa9510',
    'https://f-launcher.ru/fox/new/mirror/assets/objects/51/513c5616deab01a39e4c22cf1469765e1e36af2a'
];

async function test() {
    for (const url of urls) {
        console.log('Testing:', url);
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 HeliosLauncher/1.0' }
            });
            console.log('Status:', res.status, res.statusText);
        } catch (e) {
            console.error('Error:', e.message);
        }
    }
}

test();
