const os = require('os')

const PROFILES = {
    LOW: {
        name: 'LOW',
        maxPeers: 3,
        bufferSize: 16 * 1024, // 16KB
        passive: true, // Passive seeding only (do not actively announce as a major source)
        weight: 5
    },
    MID: {
        name: 'MID',
        maxPeers: 15,
        bufferSize: 64 * 1024, // 64KB
        passive: false,
        weight: 25
    },
    HIGH: {
        name: 'HIGH',
        maxPeers: 50,
        bufferSize: 512 * 1024, // 512KB
        passive: false, // Aggressive seeding
        weight: 50
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
            return { ...PROFILES.LOW }
        }

        // High End: > 8GB RAM and >= 8 Cores
        if (totalMem > EIGHT_GB && cpuCount >= 8) {
            return { ...PROFILES.HIGH }
        }

        // Default to Mid
        return { ...PROFILES.MID }
    }

    getProfile() {
        return this.profile
    }

    // Call this if network speed is determined to be high/stable
    boostWeight() {
        if (this.profile.weight < 20) {
            this.profile.weight += 1 // Increment slower
            console.log(`[NodeAdapter] Network boost applied. New weight: ${this.profile.weight}`)
        }
    }

    // Call this if connections are timing out or unreliable
    penaltyWeight() {
        if (this.profile.weight > 0) {
            this.profile.weight -= 1
            if (this.profile.weight < 0) this.profile.weight = 0
            console.log(`[NodeAdapter] Performance penalty applied. New weight: ${this.profile.weight}`)
        }
        return this.profile.weight
    }

    // Force switch to LOW profile (Passive)
    downgradeToLow() {
        if (this.profile.name !== 'LOW') {
            console.log('[NodeAdapter] Downgrading to LOW profile (Passive Mode) due to poor upload speed.')
            // Object.assign to preserve reference held by consumers
            Object.assign(this.profile, PROFILES.LOW)
            // Ensure we don't announce if we were penalized heavily before?
            // LOW profile has default weight 1.
            return true
        }
        return false
    }

    isCritical() {
        return this.profile.weight <= 0
    }
}

module.exports = new NodeAdapter()
