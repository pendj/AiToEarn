import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = 'http://127.0.0.1:18880';
const password = execFileSync('ssh', ['-i', '/root/.ssh/163.192.46.78.key', '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ForwardAgent=no', '-o', 'StrictHostKeyChecking=yes', '-o', 'UpdateHostKeys=no', 'ubuntu@163.192.46.78', 'cat /srv/luxsabers-social/.private/operator-password.txt'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
await mkdir('.runtime/browser', { recursive: true, mode: 0o700 });
const browser = await chromium.launch({ headless: true });
try {
  for (const [name, viewport] of [['desktop', { width: 1440, height: 1000 }], ['mobile', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, locale: 'en-US', reducedMotion: 'reduce' });
    const page = await context.newPage();
    const failures = [];
    page.on('pageerror', () => failures.push('browser_runtime_error'));
    const response = await page.goto(`${base}/en`, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    assert.equal(new URL(page.url()).pathname, '/session/login');
    await page.screenshot({ path: `.runtime/browser/${name}-login.png`, fullPage: true });
    await page.getByLabel('Username').fill('luxsabers');
    await page.getByLabel('Password').fill(password);
    const loginRequest = page.waitForRequest(request => request.method() === 'POST' && new URL(request.url()).pathname === '/session/login');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const submitted = await loginRequest;
    console.log(JSON.stringify({ viewport: name, loginOrigin: submitted.headers().origin ?? 'absent' }));
    try {
      await page.waitForURL(url => url.pathname.startsWith('/en'), { timeout: 30000, waitUntil: 'domcontentloaded' });
    } catch {
      await page.screenshot({ path: `.runtime/browser/${name}-navigation-failure.png`, fullPage: true, timeout: 10000 });
      console.log(JSON.stringify({ viewport: name, failurePath: new URL(page.url()).pathname, text: (await page.locator('body').innerText()).slice(0, 1000) }));
      throw new Error('Authenticated workspace navigation failed');
    }
    await page.locator('body').waitFor({ state: 'visible' });
    await page.waitForFunction(() => document.body.innerText.trim().length > 50, undefined, { timeout: 30000 });
    const layout = await page.evaluate(() => ({
      width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      textLength: document.body.innerText.trim().length,
      links: [...document.querySelectorAll('a[href]')].filter(el => el.getBoundingClientRect().width).map(el => ({ text: el.innerText.trim().slice(0, 60), path: new URL(el.href).pathname })).slice(0, 25),
      brokenImages: [...document.images].filter(el => el.complete && !el.naturalWidth).length,
      images: document.images.length,
    }));
    await page.screenshot({ path: `.runtime/browser/${name}-workspace.png`, fullPage: true });
    assert.ok(layout.scrollWidth <= layout.width + 1, 'Horizontal overflow');
    assert.equal(failures.length, 0, 'Frontend runtime error');
    console.log(JSON.stringify({ viewport: name, authenticated: true, layout }));
    await page.goto(`${base}/session`);
    assert.equal(await page.getByText('Publishing paused', { exact: true }).count(), 1);
    const resume = page.getByRole('button', { name: 'Resume automation', exact: true });
    assert.equal(await resume.count(), 1, 'Expected the deployed automation controls');
    assert.equal(await resume.isDisabled(), true, 'Unauthorized resume must be disabled');
    const statusResponse = await context.request.get(`${base}/session/automation.json`);
    assert.equal(statusResponse.status(), 200);
    const status = await statusResponse.json();
    assert.equal(status.control.paused, 1);
    assert.ok(Date.now() - Date.parse(status.control.heartbeat) < 60000, 'Worker heartbeat is stale');
    const statusLayout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
    assert.ok(statusLayout.scrollWidth <= statusLayout.width + 1, 'Automation layout overflow');
    await page.screenshot({ path: `.runtime/browser/${name}-automation.png`, fullPage: true });
    await page.getByRole('link', { name: 'Workspace', exact: true }).click();
    await page.waitForURL(url => url.pathname.startsWith('/en'));
    await page.goto(`${base}/session`);
    console.log(JSON.stringify({ viewport: name, automationPaused: true, liveHeartbeat: true, resumeDisabled: true, statusLayout }));
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/session/login');
    const denied = await context.request.get(`${base}/api/user/mine`);
    assert.equal(denied.status(), 401);
    await context.close();
  }
} finally {
  await browser.close();
}
