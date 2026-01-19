const os = require('os')

const PROFILES = {
    LOW: {
        name: 'LOW',
        maxPeers: 3,
        bufferSize: 16 * 1024, // 16KB
        passive: true, // Passive seeding only (do not actively announce as a major source)
        weight: 1
    },
    MID: {
        name: 'MID',
        maxPeers: 15,
        bufferSize: 64 * 1024, // 64KB
        passive: false,
        weight: 5
    },
    HIGH: {
        name: 'HIGH',
        maxPeers: 50,
        bufferSize: 512 * 1024, // 512KB
        passive: false, // Aggressive seeding
        weight: 10
    }
}

class NodeAdapter {
    constructor() {
        this.profile = this.detectProfile()
        console.log(`[NodeAdapter] System Profile Detected: ${this.profile.name}`)
    }

    detectProfile() {
        const totalMem = os.totalmem() // Bytes
        const cpus = os.cpus()
        const cpuCount = cpus.length

        // Memory thresholds
        const FOUR_GB = 4 * 1024 * 1024 * 1024
        const EIGHT_GB = 8 * 1024 * 1024 * 1024

        // Low End: < 4GB RAM or Single Core
        if (totalMem < FOUR_GB || cpuCount < 2) {
            return PROFILES.LOW
        }

        // High End: > 8GB RAM and >= 4 Cores
        if (totalMem > EIGHT_GB && cpuCount >= 4) {
            return PROFILES.HIGH
        }

        // Default to Mid
        return PROFILES.MID
    }

    getProfile() {
        return this.profile
    }

    // Call this if network speed is determined to be high/stable
    boostWeight() {
        if (this.profile.weight < 20) {
            this.profile.weight += 5
            console.log(`[NodeAdapter] Network boost applied. New weight: ${this.profile.weight}`)
        }
    }
}

module.exports = new NodeAdapter()
