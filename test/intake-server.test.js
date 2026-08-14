import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * cmdServe's HTTP intake handler (isSameOrigin CSRF check, MAX_BODY_BYTES cap,
 * content-type gate, static-file path-traversal guard) is security-relevant
 * and was untested — trusted to read correctly rather than verified. cli.ts
 * runs main() at import time and die() calls process.exit(), so this can't
 * be unit-tested by importing the module; it spawns the real CLI as a child
 * process and issues real HTTP requests, same as this feature was manually
 * verified during development.
 */

const PORT = 8193;
const BASE = `http://127.0.0.1:${PORT}`;
const CLI_PATH = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function waitForServer(url, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  throw new Error(`server at ${url} did not come up within ${timeoutMs}ms`);
}

let child;

test.before(async () => {
  child = spawn(process.execPath, [CLI_PATH, 'serve', '--port', String(PORT)], {
    cwd: REPO_ROOT,
    stdio: 'ignore',
  });
  await waitForServer(`${BASE}/add`);
});

test.after(() => {
  child?.kill();
});

test('same-origin POST to /api/add is not blocked by CSRF (reaches validation, not 403)', async () => {
  const res = await fetch(`${BASE}/api/add`, {
    method: 'POST',
    headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'raw=',
  });
  assert.notEqual(res.status, 403);
  assert.equal(res.status, 400); // empty raw story fails validation before touching disk
});

test('cross-origin POST to /api/add is rejected with 403', async () => {
  const res = await fetch(`${BASE}/api/add`, {
    method: 'POST',
    headers: { origin: 'http://evil.example', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'raw=hello&zone=Downtown&category=id_documents&advocate=a&consent_method=verbal',
  });
  assert.equal(res.status, 403);
});

test('POST to /api/add with the wrong content-type is rejected with 415', async () => {
  const res = await fetch(`${BASE}/api/add`, {
    method: 'POST',
    headers: { origin: BASE, 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(res.status, 415);
});

test('POST to /api/add over the body-size cap is rejected with 413', async () => {
  const res = await fetch(`${BASE}/api/add`, {
    method: 'POST',
    headers: { origin: BASE, 'content-type': 'application/x-www-form-urlencoded' },
    body: 'raw=' + 'x'.repeat(300 * 1024), // MAX_BODY_BYTES is 256 * 1024
  });
  assert.equal(res.status, 413);
});

test('a path-traversal attempt against the static file server is refused', async () => {
  const res = await fetch(`${BASE}/../../../../../../etc/passwd`, { redirect: 'manual' });
  assert.notEqual(res.status, 200);
  const body = await res.text();
  assert.doesNotMatch(body, /root:.*:0:0:/, 'must not have served /etc/passwd');
});

test('GET /add renders the intake form', async () => {
  const res = await fetch(`${BASE}/add`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<form method="post" action="\/api\/add">/);
});

test('data/pending-review.json is never served, even when it exists', async () => {
  // Gitignored and normally absent — written here just long enough to prove the
  // guard, not left behind. Held-for-review SMS submissions (gateway/sms.ts) are
  // signed but unreviewed; serving this file would put unreviewed text on the wire.
  const path = join(REPO_ROOT, 'data', 'pending-review.json');
  await writeFile(path, '[]\n');
  try {
    const res = await fetch(`${BASE}/data/pending-review.json`);
    assert.equal(res.status, 404);
  } finally {
    await rm(path, { force: true });
  }
});
