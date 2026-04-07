/**
 * global-teardown.ts
 * Stops any services that were started by global-setup (tracked in a PID file).
 */

import * as fs from 'fs';
import * as path from 'path';

const PID_FILE = path.join(__dirname, '..', '.local-dev', 'e2e-pids');

export default async function globalTeardown(): Promise<void> {
  if (!fs.existsSync(PID_FILE)) return;

  const content = fs.readFileSync(PID_FILE, 'utf-8');
  const pids = content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map(Number)
    .filter((n) => !isNaN(n));

  for (const pid of pids) {
    try {
      // Kill the entire process group (negative PID) so child processes spawned
      // by wrangler (e.g. workerd) are also terminated and don't hold ports open.
      process.kill(-pid, 'SIGTERM');
      console.log(`Stopped service process group ${pid}`);
    } catch {
      // Process group may not exist — try killing the individual PID as fallback
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`Stopped service PID ${pid}`);
      } catch {
        // Already dead — ignore
      }
    }
  }

  fs.unlinkSync(PID_FILE);
  console.log('Global teardown complete.');
}
