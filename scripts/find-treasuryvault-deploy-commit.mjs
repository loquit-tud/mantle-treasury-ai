/**
 * Finds the git commit whose TreasuryVault creation bytecode matches a known deploy tx input.
 * Usage (repo root): node scripts/find-treasuryvault-deploy-commit.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, '..');

function run(cmd, opts = {}) {
  return execSync(cmd, { encoding: 'utf8', cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'], ...opts });
}

const txJson = JSON.parse(
  run(
    'cast tx 0x7e318123f1b107e57fd3c3feea843e08ce70ecb0705b46debcc90ea7d7a0b37b --rpc-url https://rpc.mantle.xyz --json',
  ),
);
const targetHex = txJson.input.replace(/^0x/i, '');

const CTOR =
  '000000000000000000000000779ded0c9e1022225f8e0630b35a9b54be713736000000000000000000000000458f293454fe0d67ec0655f3672301301dd51422';

if (!targetHex.toLowerCase().endsWith(CTOR.toLowerCase())) {
  console.error('Unexpected: deploy input suffix != expected constructor args');
  process.exit(1);
}

const head = run('git rev-parse HEAD').trim();
const commits = run('git rev-list --reverse --before="2026-05-09T00:00:00Z" HEAD')
  .trim()
  .split('\n')
  .filter(Boolean);

console.error(`Scanning ${commits.length} commits (before 2026-05-09 UTC), target input len=${targetHex.length} hex chars`);

let found = null;
for (const sha of commits) {
  try {
    run(`git checkout -q ${sha}`);
    run('forge build --quiet', { stdio: ['pipe', 'pipe', 'pipe'] });
    const art = join(REPO, 'contracts/out/TreasuryVault.sol/TreasuryVault.json');
    if (!existsSync(art)) continue;
    const { bytecode } = JSON.parse(readFileSync(art, 'utf8'));
    const bc = bytecode.object.replace(/^0x/i, '');
    const assembled = bc + CTOR;
    if (assembled.toLowerCase() === targetHex.toLowerCase()) {
      found = sha;
      break;
    }
  } catch {
    /* forge may fail on some commits */
  }
}

run(`git checkout -q ${head}`);

if (found) {
  const one = run(`git log -1 --oneline ${found}`).trim();
  const iso = run(`git log -1 --format=%cI ${found}`).trim();
  console.log(JSON.stringify({ match: true, commit: found, committedAt: iso, summary: one }, null, 2));
} else {
  console.log(JSON.stringify({ match: false, scanned: commits.length }, null, 2));
  process.exit(2);
}
