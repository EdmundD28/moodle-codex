import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { redactSecrets } from './moodle-client.mjs';

export const MAX_DOWNLOAD = 20 * 1024 * 1024;
const digest = value => createHash('sha256').update(value).digest('hex');

export function fileCatalog(sections) {
  return sections.flatMap(s => (s.modules ?? []).flatMap(m => (m.contents ?? [])
    .filter(f => f.type === 'file' && f.fileurl)
    .map(f => ({ ...f, module_id: m.id, module_name: m.name, source_url: m.url,
      file_id: digest(JSON.stringify([m.id, f.filepath ?? '/', f.filename])).slice(0, 32) }))));
}

// Only URLs just returned by the authenticated course API can reach this function.
export function downloadUrl(baseUrl, fileurl, token) {
  const base = new URL(baseUrl), url = new URL(fileurl);
  const root = base.pathname.replace(/\/$/, '');
  if (url.origin !== base.origin || url.protocol !== 'https:' || url.username || url.password)
    throw Error('File download requires same-origin HTTPS without embedded credentials.');
  const allowed = [root + '/webservice/pluginfile.php', root + '/pluginfile.php'];
  const prefix = allowed.find(p => url.pathname === p || url.pathname.startsWith(p + '/'));
  if (!prefix) throw Error('Only Moodle pluginfile endpoints are allowed.');
  if (prefix === root + '/pluginfile.php') url.pathname = root + '/webservice' + url.pathname.slice(root.length);
  for (const key of [...url.searchParams.keys()]) if (!['file', 'forcedownload'].includes(key)) url.searchParams.delete(key);
  url.searchParams.set('token', token);
  return url;
}

export async function downloadFile(client, file) {
  if (file.filesize > MAX_DOWNLOAD) throw Error('File exceeds the 20 MiB download limit.');
  const url = downloadUrl(client.baseUrl, file.fileurl, client.token);
  try {
    const response = await client.fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(client.timeoutMs) });
    if (!response.ok) throw Error('File download HTTP ' + response.status);
    if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD) {
      await response.body?.cancel(); throw Error('File exceeds the 20 MiB download limit.');
    }
    const parts = []; let size = 0;
    for await (const part of response.body) {
      size += part.length;
      if (size > MAX_DOWNLOAD) throw Error('File exceeds the 20 MiB download limit.');
      parts.push(Buffer.from(part));
    }
    const bytes = Buffer.concat(parts);
    const type = response.headers.get('content-type') ?? '';
    if (/json|html/i.test(type) && !/\.(?:html?|json)$/i.test(file.filename))
      throw Error('Moodle returned an error or login document instead of the requested file.');
    if (/^\s*\{\s*"(?:exception|error|errorcode)"/.test(bytes.subarray(0, 512).toString()))
      throw Error('Moodle rejected file access.');
    return bytes;
  } catch (error) { throw Error(redactSecrets(error.message, client.token)); }
}

export async function saveDownload(bytes, file, directory) {
  // Content-addressed .bin files prevent execution and cannot escape the cache.
  await mkdir(directory, { recursive: true });
  const sha256 = digest(bytes), path = join(directory, sha256 + '.bin');
  await writeFile(path, bytes, { flag: 'wx', mode: 0o600 }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  return { path, sha256, bytes: bytes.length, original_filename: file.filename };
}

export function parseFile(bytes, filename, options = {}) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./parser-worker.mjs', import.meta.url), {
      workerData: { bytes, filename, options }, resourceLimits: { maxOldGenerationSizeMb: 128 },
      stdout: true, stderr: true,
    });
    // Third-party parser diagnostics must never corrupt the MCP stdout protocol.
    worker.stdout.resume(); worker.stderr.resume();
    const timer = setTimeout(() => { worker.terminate(); reject(Error('File parsing exceeded 15 seconds.')); }, 15000);
    worker.once('message', data => { clearTimeout(timer); worker.terminate(); data.error ? reject(Error(data.error)) : resolve(data); });
    worker.once('error', error => { clearTimeout(timer); reject(error); });
    worker.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(Error('File parser stopped before completion.')); });
  });
}

