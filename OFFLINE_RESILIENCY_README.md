# Offline Resiliency in HeliosLauncher

This document outlines the offline resiliency features of the HeliosLauncher, which ensure the launcher remains functional even during network outages.

## Core Objective

The primary goal of these changes is to prioritize the launcher's ability to start and launch applications, even when external servers are unreachable. Assuming the necessary application files are already present locally, the launcher will be able to operate in a complete offline state.

## New Behaviors

### Resilient File Verification

- The file verification and repair process is now more resilient to network errors.
- If a network error is encountered during file verification or download, the launcher will make **3 attempts** to complete the operation with **exponential backoff**.
- If all retries fail, the error will be logged as a non-fatal warning, and the launch will proceed using the local files as-is. This ensures that transient network issues or server outages do not prevent you from launching your applications.

### Non-Blocking Repository & Metadata Fetching

- The launcher's startup processes for fetching remote data (such as repository information, updates, and news) are now non-blocking.
- The same retry-and-fallback logic has been applied to these processes. If all retries fail, the step is gracefully skipped.
- The launcher will boot to a usable state and allow you to launch applications even if it cannot contact any external servers.

### True Offline Mode

- The entire application flow, from starting the launcher to clicking the "launch" button, is now functional without an active internet connection.
- All network-dependent functions will fail gracefully without preventing you from accessing already-installed content.

## How the Launcher Functions During Network Outages

When the launcher is started without an internet connection, it will:

1.  Attempt to fetch the distribution index. If it fails, it will proceed in offline mode.
2.  Attempt to verify and repair files. If it fails, it will use the local files.
3.  Attempt to authenticate with Microsoft's servers. If it fails, you will still be able to use the launcher with your existing offline session.

This ensures that you can always launch your applications, as long as the files are already downloaded to your machine.
