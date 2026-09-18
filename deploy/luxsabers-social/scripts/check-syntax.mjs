import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
for (const dir of ['gateway','automation','scripts']) {
  for (const file of readdirSync(dir).filter(x => x.endsWith('.mjs'))) execFileSync(process.execPath, ['--check', `${dir}/${file}`], { stdio: 'inherit' });
}
execFileSync(process.execPath, ['--check', 'server/r2-transport.cjs'], { stdio: 'inherit' });
execFileSync(process.execPath, ['--check', 'server/r2-policy.cjs'], { stdio: 'inherit' });
