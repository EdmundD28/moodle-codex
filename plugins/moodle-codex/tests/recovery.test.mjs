import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../scripts/read-tool.mjs', import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], {
  cwd: process.env.TEMP || '/', encoding: 'utf8', timeout: 20000,
  env: { ...process.env, MOODLE_BASE_URL: '', MOODLE_TOKEN: '' },
});
test('recovery launches MCP from an unrelated directory and reports missing configuration', () => {
  const r = run('check_connection');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(JSON.parse(r.stdout).configuration.configured, false);
});
test('recovery rejects unapproved tool names before starting a server', () => {
  const r = run('mod_assign_submit_assignment');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unsupported Moodle for Codex tool/);
});
