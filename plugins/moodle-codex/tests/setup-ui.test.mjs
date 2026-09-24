import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const scriptUrl = new URL('../scripts/configure-mobile.ps1', import.meta.url);

test('setup window waits for an explicit Moodle sign-in click', async () => {
  const source = await readFile(scriptUrl, 'utf8');

  assert.match(source, /Obtain token \(tested for UNSW Moodle only\)/);
  assert.match(source, /1\. Click Open UNSW Moodle sign-in\./);
  assert.match(source, /2\. In the same browser tab, replace the address bar with https:\/\/moodle\.telt\.unsw\.edu\.au\/login\/index\.php/);
  assert.match(source, /3\. On the confirmation page, right-click the blue link and choose Copy link address\./);
  assert.match(source, /\$openButton\.Text = 'Open UNSW Moodle sign-in'/);
  assert.match(source, /\$setupTitle\.Text = 'Setup plugin'/);
  assert.match(source, /Paste the complete moodlemobile:\/\/ link below\./);
  assert.doesNotMatch(source, /\$openButton\.PerformClick\(\)/);
  assert.match(source, /\$openButton\.Add_Click\(\{/);
});
