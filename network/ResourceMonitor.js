const os = require('os')
const { EventEmitter } = require('events')

class ResourceMonitor extends EventEmitter {
    constructor() {
        super()
        this.cpuUsage = 0
        this.interval = null
        this.lastCpus = os.cpus()
        this.isMonitoring = false
    }

    start(intervalMs = 2000) {
        if (this.isMonitoring) return
        this.isMonitoring = true
        this.interval = setInterval(() => this._measureLoop(), intervalMs)
    }

    stop() {
        this.isMonitoring = false
        if (this.interval) {
            clearInterval(this.interval)
            this.interval = null
        }
    }

    getCPUUsage() {
        return this.cpuUsage
    }

    getStressLevel() {
        if (this.cpuUsage > 90) return 'CRITICAL'
        if (this.cpuUsage > 70) return 'HIGH'
        if (this.cpuUsage > 50) return 'MEDIUM'
        return 'LOW'
    }

    _measureLoop() {
        const cpus = os.cpus()
        let idle = 0
        let total = 0

        for (let i = 0; i < cpus.length; i++) {
            const cpu = cpus[i]
            const lastCpu = this.lastCpus[i]

            for (const type in cpu.times) {
                total += cpu.times[type] - lastCpu.times[type]
            }
            idle += cpu.times.idle - lastCpu.times.idle
        }

        this.lastCpus = cpus

        // Calculate percentage
        if (total > 0) {
            const usage = 100 - Math.round(100 * idle / total)
            this.cpuUsage = usage
            // console.debug(`[ResourceMonitor] CPU Usage: ${usage}%`)
        }
    }
}

module.exports = new ResourceMonitor()
