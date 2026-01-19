module.exports = {
    // Sovereign Infrastructure Config

    // Array of host:port strings for private RF-based VPS fleet
    BOOTSTRAP_NODES: [
        { host: 'bootstrap1.zombie-net.org', port: 49737 }, // Placeholder for private fleet
        { host: 'bootstrap2.zombie-net.org', port: 49737 }
    ],

    // Backup URLs in case Mojang is totally blocked
    HTTP_MIRRORS: [
        'https://piston-meta.mojang.com',
        'https://launchermeta.mojang.com',
        'https://files.minecraftforge.net/maven'
    ],

    // Discovery settings
    DISCOVERY: {
        MDNS: true,      // Crucial for zero-latency LAN P2P
        DHT: true,       // Enable Distributed Hash Table
        PUBLIC_DHT: true // Attempt to use public DHT if private fails
    },

    // P2P Protocol Constants
    PROTOCOL: {
        VERSION: 1,
        TIMEOUT: 5000,   // 5s timeout for requests
        MAX_RETRIES: 3
    }
}
