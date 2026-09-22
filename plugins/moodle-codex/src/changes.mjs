import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redactSecrets } from './moodle-client.mjs';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
const canonical = value => JSON.stringify(stable(value));
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
const pick = (obj, keys) => Object.fromEntries(keys.map(k => [k, obj[k] ?? null]));
function fileFields(files) {
  return (files ?? []).filter(f => f.type !== 'url').map(f => pick(f,
    ['filename', 'filepath', 'filesize', 'fileurl', 'timemodified', 'contenthash']))
    .sort((a,b) => canonical(a).localeCompare(canonical(b)));
}
export function courseRecords(sections, assignments) {
  const records = {};
  for (const s of sections) {
    records['section:' + s.id] = { ...pick(s, ['name', 'summary', 'visible']), kind: 'section' };
    for (const m of s.modules ?? []) records['module:' + m.id] = {
      ...pick(m, ['name', 'description', 'url', 'visible', 'availabilityinfo', 'dates']),
      kind: 'module', section_id: s.id, files: fileFields(m.contents),
    };
  }
  if (assignments) for (const c of assignments.courses ?? []) for (const a of c.assignments ?? [])
    records['assignment:' + a.id] = { ...pick(a, ['name', 'intro', 'duedate', 'cutoffdate', 'allowsubmissionsfromdate', 'gradingduedate']),
      kind: 'assignment', files: fileFields([...(a.introattachments ?? []), ...(a.introfiles ?? [])]) };
  return records;
}
function preview(value) {
  const text = canonical(value ?? null);
  return { value: text.length <= 600 ? value ?? null : text.slice(0,600), truncated: text.length > 600, sha256: hash(value ?? null) };
}
export function compareRecords(before, after, assignmentComplete = true) {
  const changes = [];
  for (const id of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    if (!assignmentComplete && id.startsWith('assignment:')) continue;
    const a = before[id], b = after[id];
    if (canonical(a) === canonical(b)) continue;
    changes.push({ id, name: b?.name ?? a?.name, type: !a ? 'added' : !b ? 'no_longer_visible' : 'modified',
      fields: [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])].filter(k => canonical(a?.[k]) !== canonical(b?.[k]))
        .map(k => ({ field: k, before: preview(a?.[k]), after: preview(b?.[k]) })) });
  }
  return changes;
}

export async function checkChanges(client, courseId, directory) {
  const site = await client.getSiteInfo();
  if (!site.userid) throw Error('Cannot scope snapshots without current Moodle user ID.');
  const key = hash([client.baseUrl, site.userid, courseId, 1]);
  await mkdir(directory, { recursive: true });
  const path = join(directory, key + '.json'), lockpath = path + '.lock';
  let lock;
  try { lock = await open(lockpath, 'wx'); }
  catch (e) { if (e.code === 'EEXIST') throw Error('Course snapshot is busy. A leftover .lock after a crash must be inspected before removal.'); throw e; }
  try {
    let previous = null;
    try { previous = JSON.parse(await readFile(path, 'utf8')); }
    catch (e) { if (e.code !== 'ENOENT') throw Error('Snapshot is unreadable; existing baseline was preserved.'); }
    if (previous && (previous.schema !== 1 || !previous.records || !previous.coverage)) throw Error('Snapshot schema is invalid; baseline preserved.');
    const sections = await client.getCourseContents(courseId);
    if (!Array.isArray(sections)) throw Error('Incomplete course response; baseline preserved.');
    let assignments = null, assignmentComplete = false, assignmentError = null;
    try {
      assignments = await client.listAssignments([courseId]);
      assignmentComplete = Array.isArray(assignments.courses) && assignments.courses.some(c => c.id === courseId) && !(assignments.warnings?.length);
      if (!assignmentComplete) assignmentError = { message: 'Assignment coverage incomplete', warnings: assignments.warnings ?? [] };
    } catch (e) { assignmentError = { message: redactSecrets(e.message, client.token) }; }
    const records = courseRecords(sections, assignmentComplete ? assignments : null);
    if (!assignmentComplete && previous) for (const [id, record] of Object.entries(previous.records))
      if (id.startsWith('assignment:')) records[id] = record;
    const baselineAssignments = previous?.coverage.assignments_initialized ?? false;
    const changes = previous ? compareRecords(previous.records, records, assignmentComplete && baselineAssignments) : [];
    const capturedAt = new Date().toISOString();
    const snapshot = { schema: 1, captured_at: capturedAt, records,
      coverage: { assignments_initialized: baselineAssignments || assignmentComplete,
        assignments_checked_at: assignmentComplete ? capturedAt : previous?.coverage.assignments_checked_at ?? null } };
    const temporary = path + '.' + randomUUID() + '.tmp';
    try { await writeFile(temporary, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
    finally { await unlink(temporary).catch(() => {}); }
    return { course_id: courseId, baseline_created: !previous, compared_to: previous?.captured_at ?? null,
      captured_at: capturedAt, changes, assignment_baseline_created: assignmentComplete && !baselineAssignments,
      coverage: { course_contents: true, assignments: assignmentComplete, assignment_error: assignmentError },
      limitations: 'Detects API descriptions, file metadata and assignment dates; unchanged file metadata does not prove unchanged bytes. Missing resources mean no longer visible, not confirmed deletion. External sites, forum post bodies and PDFs are not scanned by this tool. This is an on-demand check, not a scheduler.' };
  } finally { await lock.close(); await unlink(lockpath); }
}

