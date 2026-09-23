import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../scripts/configure-mobile.ps1', import.meta.url);

test('setup window waits for an explicit Moodle sign-in click', async () => {
  const source = await readFile(scriptUrl, 'utf8');

  assert.match(
    source,
    /\$label\.Text = '1\. Copy the complete moodlemobile:\/\/ link\.  2\. Paste it below\./,
  );
  assert.doesNotMatch(source, /\$openButton\.PerformClick\(\)/);
  assert.match(source, /\$openButton\.Add_Click\(\{/);
});
