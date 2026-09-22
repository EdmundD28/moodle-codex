import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { redactSecrets } from '../src/moodle-client.mjs';

// Recovery uses the exact same server, schemas and read-only allowlist as MCP.
const allowed = new Set(['check_connection', 'get_site_info', 'list_courses',
  'get_course_contents', 'list_assignments', 'get_submission_status', 'get_upcoming_deadlines',
  'list_course_files', 'download_course_file', 'read_course_file', 'list_course_forums',
  'list_forum_discussions', 'get_forum_posts', 'get_assignment_feedback', 'get_grading_definition', 'check_course_changes']);
const client = new Client({ name: 'moodle-recovery', version: '1.0.0' });
try {
  const [name, argumentFile, outputFile] = process.argv.slice(2);
  if (!allowed.has(name)) throw new Error('Unsupported read-only tool');
  const args = argumentFile ? JSON.parse(await readFile(argumentFile, 'utf8')) : {};
  if (!args || Array.isArray(args) || typeof args !== 'object') throw new Error('Arguments must be an object');
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('../server.mjs', import.meta.url))],
    cwd: fileURLToPath(new URL('../', import.meta.url)), env: process.env, stderr: 'pipe' });
  await client.connect(transport, { timeout: 15000 });
  const result = await client.callTool({ name, arguments: args }, undefined, { timeout: 120000 });
  const value = redactSecrets(result.structuredContent ?? result, process.env.MOODLE_TOKEN ?? '');
  const json = JSON.stringify(value, null, 2);
  if (outputFile) {
    await writeFile(outputFile, json, { flag: 'wx' });
    console.log(JSON.stringify({ saved: outputFile, characters: json.length, isError: !!result.isError }));
  } else if (json.length > 12000) {
    throw new Error('Result exceeds console limit; rerun with an output file and read only relevant fields');
  } else console.log(json);
  if (result.isError) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ error: redactSecrets(String(error.message), process.env.MOODLE_TOKEN ?? '') }));
  process.exitCode = 1;
} finally {
  // close also cleans up a partially connected transport.
  await client.close().catch(() => {});
}

