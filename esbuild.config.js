const esbuild = require('esbuild')
const path = require('path')
const { execSync } = require('child_process')

let buildHash = 'unknown'
try {
    buildHash = execSync('git rev-parse --short HEAD').toString().trim()
} catch (e) {
    console.warn('Failed to get build hash:', e.message)
}

esbuild.build({
    entryPoints: [
        path.join(__dirname, 'app', 'assets', 'js', 'renderer-entry.js')
    ],
    bundle: true,
    outfile: path.join(__dirname, 'app', 'dist', 'renderer.bundle.js'),
    platform: 'browser',
    target: 'chrome100',
    format: 'iife',
    minify: true,
    sourcemap: true,
    banner: {
        js: `
            window.global = window;
            if (typeof window.HeliosAPI !== 'undefined') {
                window.ipcRenderer = window.HeliosAPI.ipc;
                window.shell = window.HeliosAPI.shell;
                window.currentWindow = window.HeliosAPI.window;
                window.appVersion = window.HeliosAPI.app.getVersion();
            }
        `
    },
    nodePaths: [
        path.join(__dirname, 'app'),
        path.join(__dirname, 'app', 'assets', 'js')
    ],
    define: {
        'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'development'),
        'process.env.BUILD_HASH': JSON.stringify(buildHash),
        'process.type': '"renderer"',
        'global': 'window',
        'Buffer': 'window.Buffer'
    },
    external: [],
    alias: {
        'electron': path.resolve(__dirname, 'app/assets/js/mocks/electron.js'),
        'fs': path.resolve(__dirname, 'app/assets/js/mocks/fs-polyfill.js'),
        'fs/promises': path.resolve(__dirname, 'app/assets/js/mocks/fs-polyfill.js'),
        'os': path.resolve(__dirname, 'app/assets/js/mocks/os-polyfill.js'),
        'path': path.resolve(__dirname, 'app/assets/js/mocks/path-polyfill.js'),
        'child_process': path.resolve(__dirname, 'app/assets/js/mocks/child_process-mock.js'),
        '@electron/remote': path.join(__dirname, 'app', 'assets', 'js', 'mocks', 'remote.js'),
        'sodium-native': path.resolve(__dirname, 'app/assets/js/mocks/sodium-mock.js'),
        'net': path.resolve(__dirname, 'app/assets/js/mocks/net-mock.js'),
        'tls': path.resolve(__dirname, 'app/assets/js/mocks/net-mock.js'), // Shared with net for basic stubs
        'dns': path.resolve(__dirname, 'app/assets/js/mocks/dns-mock.js'),
        'dns/promises': path.resolve(__dirname, 'app/assets/js/mocks/dns-mock.js'),
        'crypto': path.resolve(__dirname, 'app/assets/js/mocks/crypto-polyfill.js'),
        'stream': path.resolve(__dirname, 'app/assets/js/mocks/stream-polyfill.js'),
        'stream/promises': path.resolve(__dirname, 'app/assets/js/mocks/stream-polyfill.js'),
        'zlib': path.resolve(__dirname, 'app/assets/js/mocks/zlib-mock.js'),
        'url': path.resolve(__dirname, 'app/assets/js/mocks/url-polyfill.js'),
        'util': path.resolve(__dirname, 'app/assets/js/mocks/util-polyfill.js'),
        'events': path.resolve(__dirname, 'app/assets/js/mocks/events.js'),
        'buffer': path.resolve(__dirname, 'app/assets/js/mocks/buffer-polyfill.js'),
        'http': path.resolve(__dirname, 'app/assets/js/mocks/http-mock.js'),
        'https': path.resolve(__dirname, 'app/assets/js/mocks/https-mock.js'),
        'timers': path.resolve(__dirname, 'app/assets/js/mocks/timers-polyfill.js'),
        'assert': path.resolve(__dirname, 'app/assets/js/mocks/assert-mock.js'),
        'constants': path.resolve(__dirname, 'app/assets/js/mocks/constants-mock.js'),
        'electron-updater': path.resolve(__dirname, 'app/assets/js/mocks/updater-mock.js'),
        'fs-extra': path.resolve(__dirname, 'app/assets/js/mocks/fs-polyfill.js'),
        '@core': path.resolve(__dirname, 'app/assets/js/core'),
        '@ui': path.resolve(__dirname, 'app/assets/js/ui'),
        '@common': path.resolve(__dirname, 'app/assets/js/core/common'),
        '@network': path.resolve(__dirname, 'network'),
        'helios-distribution-types': path.resolve(__dirname, 'app/assets/js/core/common/DistributionClasses.js')
    },
    inject: [
        path.join(__dirname, 'app', 'assets', 'js', 'ui', 'views', 'inject-globals.js')
    ]
}).catch(() => process.exit(1))
