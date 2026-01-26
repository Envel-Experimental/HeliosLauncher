class TrafficState {
    constructor() {
        this.activeDownloads = 0
        this.activeUploads = 0
    }

    isBusy() {
        return this.activeDownloads > 0
    }

    incrementDownloads() {
        this.activeDownloads++
    }

    decrementDownloads() {
        this.activeDownloads = Math.max(0, this.activeDownloads - 1)
    }
}

module.exports = new TrafficState()
