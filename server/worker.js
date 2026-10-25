// Entry point for the separate "worker" Railway service: runs ONLY the email notifier.
// No web server, no public port. Start command: node server/worker.js
import { missingSettings, startNotifier } from './notify.js'

const missing = missingSettings()
if (missing.length) {
  // Exit non-zero so Railway shows the service as failed instead of looking healthy while doing nothing.
  console.error(`[worker] not configured. Set on THIS service: ${missing.join(', ')}`)
  process.exit(1)
}

startNotifier()
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { console.log(`[worker] ${sig}, stopping`); process.exit(0) })
