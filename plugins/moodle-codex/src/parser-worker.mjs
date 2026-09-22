import { parentPort, workerData } from 'node:worker_threads';
import yauzl from 'yauzl';
import { stripHtml } from './moodle-client.mjs';
const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const textExtension = /\.(txt|md|csv|tsv|json|ya?ml|xml|html?|py|[ch]|hpp|cpp|ino|js|mjs|ts|tsx|jsx|css|java|rs|go|toml|ini|cfg|ipynb|dmc|plc|st)$/i;
function textResult(bytes, name, options) {
  if (!textExtension.test(name)) throw Error('Unsupported text/source format. Binary programs are never executed.');
  if (bytes.length > MAX_TEXT_BYTES) throw Error('Text file exceeds 2 MiB.');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { throw Error('Text is not valid UTF-8; encoding conversion is required.'); }
  if (text.includes('\0')) throw Error('Binary data cannot be read as source text.');
  if (/\.html?$/i.test(name)) text = stripHtml(text, Infinity);
  const offset = options.offset ?? 0, limit = options.limit ?? 20000;
  return { kind: 'text', text: text.slice(offset, offset + limit), total_characters: text.length,
    offset, truncated: offset + limit < text.length, next_offset: offset + limit < text.length ? offset + limit : null };
}
async function zipResult(bytes, options) {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
      if (error) return reject(error);
      const entries = []; let total = 0, selected = null, count = 0;
      const fail = e => { zip.close(); reject(e); };
      zip.on('error', fail);
      zip.on('entry', entry => {
        count++; total += entry.uncompressedSize;
        if (count > 2000 || total > 50 * 1024 * 1024) return fail(Error('ZIP listing exceeds entry or expansion limits.'));
        if (entry.generalPurposeBitFlag & 1) return fail(Error('Encrypted ZIP is unsupported.'));
        if ((entry.externalFileAttributes >>> 16 & 0xf000) === 0xa000) return fail(Error('ZIP symlinks are rejected.'));
        entries.push({ name: entry.fileName, bytes: entry.uncompressedSize });
        if (entry.fileName !== options.zip_entry) return zip.readEntry();
        if (selected) return fail(Error('Duplicate ZIP entry name.'));
        if (entry.uncompressedSize > MAX_TEXT_BYTES || !textExtension.test(entry.fileName)) return fail(Error('Selected ZIP entry must be text/source under 2 MiB.'));
        zip.openReadStream(entry, (err, stream) => {
          if (err) return fail(err);
          const parts = []; let size = 0;
          stream.on('data', part => { size += part.length; if (size > MAX_TEXT_BYTES) { stream.destroy(); fail(Error('ZIP expansion exceeded limit.')); } else parts.push(part); });
          stream.on('error', fail);
          stream.on('end', () => { selected = Buffer.concat(parts); zip.readEntry(); });
        });
      });
      zip.on('end', () => {
        try {
          if (options.zip_entry && !selected) throw Error('ZIP entry not found.');
          resolve({ kind: 'zip', entries, total_uncompressed_bytes: total,
            ...(selected ? { entry: options.zip_entry, content: textResult(selected, options.zip_entry, options) } : {}) });
        } catch (e) { reject(e); }
      });
      zip.readEntry();
    });
  });
}
async function parse() {
  const { filename, options } = workerData, bytes = Buffer.from(workerData.bytes);
  if (/\.pdf$/i.test(filename)) {
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw Error('Invalid PDF signature.');
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(bytes), isEvalSupported: false, useSystemFonts: false, verbosity: 0 });
    const doc = await task.promise;
    try {
      const from = options.page ?? 1, to = Math.min(doc.numPages, from + (options.page_count ?? 3) - 1);
      if (from > doc.numPages) throw Error('PDF page is out of range.');
      const pages = [];
      for (let n = from; n <= to; n++) {
        const p = await doc.getPage(n), content = await p.getTextContent();
        const text = content.items.map(i => (i.str ?? '') + (i.hasEOL ? '\n' : ' ')).join('');
        const offset = options.offset ?? 0, limit = options.limit ?? 20000;
        pages.push({ page: n, text: text.slice(offset, offset + limit), offset, total_characters: text.length,
          truncated: offset + limit < text.length, next_offset: offset + limit < text.length ? offset + limit : null });
        p.cleanup();
      }
      return { kind: 'pdf', total_pages: doc.numPages, pages, next_page: to < doc.numPages ? to + 1 : null,
        coverage: 'Text layer only; scanned pages require OCR; diagrams and layout are not interpreted.' };
    } finally { await task.destroy(); }
  }
  if (/\.zip$/i.test(filename)) return zipResult(bytes, options);
  return textResult(bytes, filename, options);
}
try { parentPort.postMessage(await parse()); } catch (e) { parentPort.postMessage({ error: String(e.message).slice(0, 1000) }); }

