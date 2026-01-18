// Application Constants and Configuration
// This file contains the URLs for external resources.
// You can add multiple URLs to the arrays to act as mirrors.

// Distribution Manifest URLs (Mirrors)
// The application will try these URLs in order until one succeeds.
exports.DISTRO_URLS = [
    'https://f-launcher.ru/fox/new/distribution.json'
];

// Java Download Base URLs (Mirrors)
// Used for downloading Java Runtimes (Adoptium/Temurin)
exports.ADOPTIUM_BASE_URLS = [
    'https://api.adoptium.net/v3/assets/latest'
];

// Used for downloading Java Runtimes (Corretto)
exports.CORRETTO_BASE_URLS = [
    'https://corretto.aws/downloads'
];

// Mojang API URLs (Mirrors where applicable)
exports.MOJANG_URLS = {
    LAUNCHER_JSON: [
        'https://launchermeta.mojang.com/mc/launcher.json'
    ],
    VERSION_MANIFEST: [
        'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
    ],
    ASSET_RESOURCE: [
        'https://resources.download.minecraft.net'
    ],
    STATUS: [
        'https://status.mojang.com/check'
    ]
};

// Microsoft Authentication URLs
exports.MICROSOFT_URLS = {
    TOKEN: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
    XBL_AUTH: 'https://user.auth.xboxlive.com/user/authenticate',
    XSTS_AUTH: 'https://xsts.auth.xboxlive.com/xsts/authorize',
    MC_AUTH: 'https://api.minecraftservices.com/authentication/login_with_xbox',
    MC_PROFILE: 'https://api.minecraftservices.com/minecraft/profile',
    REDIRECT_URI: 'https://login.microsoftonline.com/common/oauth2/nativeclient',
    RELYING_PARTY_XBOX: 'http://auth.xboxlive.com',
    RELYING_PARTY_MC: 'rp://api.minecraftservices.com/'
};

// Application Specific URLs
exports.APP_URLS = {
    HOME: 'https://f-launcher.ru/',
    SENTRY_DSN: 'https://f02442d2a0733ac2c810b8d8d7f4a21e@o4508545424359424.ingest.de.sentry.io/4508545432027216',
    RELEASES_ATOM: 'https://github.com/Envel-Experimental/HeliosLauncher/releases.atom',
    RELEASES_DOWNLOAD_BASE: 'https://github.com/Envel-Experimental/HeliosLauncher/releases/download',
    SKIN_DATA_URL: 'https://mc-heads.net',
    JAVA_DOCS_ORACLE: 'https://docs.oracle.com'
};
