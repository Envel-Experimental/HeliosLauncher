const https = require('https')

const REPO = 'Envel-Experimental/HeliosLauncher'

function fetchReleases() {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: `/repos/${REPO}/releases`,
            headers: {
                'User-Agent': 'HeliosLauncher-Audit-Tool'
            }
        }

        https.get(options, (res) => {
            let data = ''
            res.on('data', (chunk) => data += chunk)
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`GitHub API error: ${res.statusCode} ${data}`))
                    return
                }
                resolve(JSON.parse(data))
            })
        }).on('error', reject)
    })
}

async function runAudit() {
    console.log(`\n=== REAL-TIME RELEASE AUDIT FOR: ${REPO} ===`)
    console.log('Fetching live data from GitHub...\n')

    try {
        const releases = await fetchReleases()
        
        if (releases.length === 0) {
            console.log('No releases found in this repository.')
            return
        }

        // 1. Находим последний стабильный релиз
        const latestStable = releases.find(r => !r.prerelease && !r.draft)
        
        // 2. Находим последний плавающий релиз (prerelease + STABLE в названии)
        const latestFloating = releases.find(r => 
            r.prerelease && 
            !r.draft && 
            (r.name || r.tag_name || '').toUpperCase().includes('STABLE')
        )

        // 3. Находим самый свежий "шумный" пре-релиз (просто для инфо)
        const latestPrerelease = releases.find(r => r.prerelease && !r.draft)

        console.log('--------------------------------------------------')
        console.log('STABLE CHANNEL (For all users):')
        if (latestStable) {
            console.log(`  Version: ${latestStable.tag_name}`)
            console.log(`  Name:    ${latestStable.name}`)
            console.log(`  Date:    ${new Date(latestStable.published_at).toLocaleString()}`)
            console.log(`  Status:  ACTIVE`)
        } else {
            console.log('  Status:  No stable releases found!')
        }

        console.log('\nFLOATING CHANNEL (Opt-in users):')
        if (latestFloating) {
            console.log(`  Version: ${latestFloating.tag_name}`)
            console.log(`  Name:    ${latestFloating.name}`)
            console.log(`  Date:    ${new Date(latestFloating.published_at).toLocaleString()}`)
            console.log(`  Status:  ACTIVE (Detected via STABLE tag)`)
        } else {
            console.log('  Status:  No valid Floating Releases found.')
            if (latestPrerelease) {
                console.log(`  Note:    Found pre-release ${latestPrerelease.tag_name}, but it lacks STABLE tag.`)
            }
        }
        console.log('--------------------------------------------------')
        
        console.log('\nVERDICT:')
        if (latestFloating && latestStable && latestFloating.published_at > latestStable.published_at) {
            console.log('>>> Rolling mode users will be ahead of Stable users. (Working as intended)')
        } else {
            console.log('>>> Everyone is on the same version or no newer Floating version exists.')
        }
        console.log('==================================================\n')

    } catch (err) {
        console.error('Audit failed:', err.message)
    }
}

runAudit()
