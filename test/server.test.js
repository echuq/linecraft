import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('HTTP server serves modules, rejects unknown files and disallows writes', { timeout: 15000 }, async () => {
  const child = spawn(process.execPath, [new URL('../scripts/serve.mjs', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')], {
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Server did not start')), 5000);
      child.stdout.on('data', data => {
        const match = String(data).match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
      child.on('error', reject);
      child.on('exit', code => { if (code) reject(new Error(`Server exited: ${code}`)); });
    });
    const html = await fetch(url, { signal: AbortSignal.timeout(5000) });
    assert.equal(html.status, 200);
    assert.match(await html.text(), /Linecraft/);
    const js = await fetch(`${url}/engine.js`);
    assert.match(js.headers.get('content-type'), /javascript/);
    assert.match(await js.text(), /export function runExperiment/);
    const missing = await fetch(`${url}/package.json`);
    assert.equal(missing.status, 404);
    const post = await fetch(url, { method: 'POST' });
    assert.equal(post.status, 405);
    const head = await fetch(url, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
  } finally {
    child.kill();
  }
});
