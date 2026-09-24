/*
 * Study-planning product logic adapted from jiujiastudy at commit
 * d5a843c051cfc056a9d1a8148314f48547ed46bc (MIT).
 * See the repository THIRD_PARTY_NOTICES.md for attribution and license text.
 *
 * This module deliberately uses Moodle for Codex's existing Web Services client.
 * It never calls Moodle functions directly and never adds a Moodle write path.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DAY = 86_400;
const OVERDUE_DAYS = 21;
const MAX_EVENT_PAGES = 10;
const EVENT_PAGE_SIZE = 50;
const MAX_STATUS_CHECKS = 40;

const asNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = value => typeof value === 'string' ? value.trim() : '';
const normalizedName = value => text(value).toLocaleLowerCase().replace(/\s+/g, ' ');
const iso = seconds => seconds > 0 ? new Date(seconds * 1000).toISOString() : null;
const sha256 = value => createHash('sha256').update(String(value)).digest('hex');
export const studyScope = (baseUrl, userId) => sha256(`${baseUrl}\n${userId}`).slice(0, 32);
const courseName = course => course?.shortname || course?.displayname || course?.fullname || `Course ${course?.id ?? '?'}`;

function submittedState(status) {
  const submission = status?.lastattempt?.submission;
  const raw = text(submission?.status).toLowerCase();
  const submitted = raw === 'submitted';
  const feedback = status?.feedback;
  const graded = Boolean(feedback?.grade || feedback?.gradefordisplay || feedback?.gradeddate || feedback?.plugins?.length);
  return {
    submitted: submitted || graded,
    label: graded ? 'graded' : submitted ? 'submitted' : raw || 'not_confirmed',
    submitted_at: asNumber(submission?.timemodified) || null,
  };
}

function relative(due, now) {
  const seconds = due - now;
  const hours = seconds / 3600;
  return {
    hours_left: Math.round(hours * 10) / 10,
    days_left: seconds >= 0 ? Math.floor(seconds / DAY) : Math.ceil(seconds / DAY),
  };
}

function firstStep(kind) {
  if (kind === 'quiz') return '打开测验页面，核对范围、时限和允许尝试次数。';
  if (kind === 'assign' || kind === 'assignment') return '打开要求，列出交付物、评分点和提交格式。';
  if (kind === 'workshop') return '打开活动，分别核对提交和互评阶段。';
  return '打开 Moodle 条目，核对要求和完成条件。';
}

function assignmentRows(coursesById, payload, statuses, baseUrl, now, end) {
  const rows = [];
  for (const group of payload?.courses ?? []) {
    const course = coursesById.get(Number(group.id)) ?? group;
    for (const assignment of group.assignments ?? []) {
      const id = Number(assignment.id);
      const status = submittedState(statuses.get(id));
      if (status.submitted) continue;
      const hardDue = asNumber(assignment.duedate);
      const cutoff = asNumber(assignment.cutoffdate);
      const due = hardDue || cutoff;
      if (due && (due > end || due < now - OVERDUE_DAYS * DAY)) continue;
      const overdue = due > 0 && due <= now;
      const pending = !hardDue;
      const cmid = Number(assignment.cmid);
      rows.push({
        id: `assignment:${id}`,
        moodle_id: id,
        course_id: Number(group.id),
        course: courseName(course),
        item: text(assignment.name) || `Assignment ${id}`,
        kind: 'assignment',
        due_at: due || null,
        due_iso: iso(due),
        ...relative(due || end, now),
        overdue,
        undated: !due,
        pending_confirmation: pending || status.label === 'not_confirmed',
        status: status.label,
        source: hardDue ? 'Moodle assignment due date' : cutoff ? 'Moodle cutoff date used as fallback' : 'Moodle assignment has no due date',
        url: cmid > 0 ? `${baseUrl}/mod/assign/view.php?id=${cmid}` : null,
        first_step: firstStep('assignment'),
      });
    }
  }
  return rows;
}

function eventMatchesAssignment(event, assignmentPayload) {
  const allAssignments = (assignmentPayload?.courses ?? []).flatMap(course =>
    (course.assignments ?? []).map(assignment => ({ ...assignment, course_id: Number(course.id) })));
  const instance = Number(event?.instance);
  const eventCourse = Number(event?.course?.id ?? event?.courseid);
  if (text(event?.modulename).toLowerCase() === 'assign' && instance > 0) {
    return allAssignments.some(assignment => Number(assignment.id) === instance);
  }
  const name = normalizedName(event?.name);
  return allAssignments.some(assignment => assignment.course_id === eventCourse && normalizedName(assignment.name) === name);
}

function eventRows(coursesById, events, assignmentPayload, now, end) {
  const rows = [];
  for (const event of events ?? []) {
    const due = asNumber(event.timesort) || asNumber(event.timestart);
    if (!due || due > end || due < now - OVERDUE_DAYS * DAY) continue;
    if (eventMatchesAssignment(event, assignmentPayload)) continue;
    const courseId = Number(event?.course?.id ?? event?.courseid);
    if (courseId && !coursesById.has(courseId)) continue;
    const course = coursesById.get(courseId) ?? event.course ?? { id: courseId };
    const kind = text(event.modulename || event.eventtype || 'event').toLowerCase();
    rows.push({
      id: `event:${Number(event.id) || sha256(`${courseId}:${event.name}:${due}`).slice(0, 16)}`,
      moodle_id: Number(event.id) || null,
      course_id: courseId || null,
      course: courseName(course),
      item: text(event.name) || 'Moodle event',
      kind,
      due_at: due,
      due_iso: iso(due),
      ...relative(due, now),
      overdue: due <= now,
      undated: false,
      pending_confirmation: false,
      status: 'not_confirmed',
      source: 'Moodle actionable calendar event',
      url: text(event?.action?.url || event.url) || null,
      first_step: firstStep(kind),
    });
  }
  return rows;
}

function deadlineSummary(rows) {
  const sorted = [...rows].sort((a, b) => (a.undated - b.undated) || ((a.due_at ?? Infinity) - (b.due_at ?? Infinity)) || a.item.localeCompare(b.item));
  const upcoming = sorted.filter(row => !row.overdue && !row.undated);
  const byCourse = new Map();
  for (const row of sorted) if (!byCourse.has(row.course)) byCourse.set(row.course, row);
  const clashes = [];
  for (let i = 0; i < upcoming.length; i += 1) {
    const group = [upcoming[i]];
    for (let j = i + 1; j < upcoming.length && upcoming[j].due_at - upcoming[i].due_at <= 48 * 3600; j += 1) group.push(upcoming[j]);
    if (group.length > 1 && !clashes.some(existing => existing.some(row => row.id === group[0].id))) clashes.push(group);
  }
  return {
    rows: sorted,
    most_urgent: upcoming[0] ?? sorted.find(row => row.overdue) ?? sorted[0] ?? null,
    next_per_course: [...byCourse.values()],
    clashes,
    counts: {
      total: sorted.length,
      upcoming: upcoming.length,
      overdue: sorted.filter(row => row.overdue).length,
      undated: sorted.filter(row => row.undated).length,
      pending_confirmation: sorted.filter(row => row.pending_confirmation).length,
    },
  };
}

export function buildDeadlineRadar({ courses = [], assignmentPayload = {}, events = [], statuses = new Map(), baseUrl = '', now = Math.floor(Date.now() / 1000), days = 14 } = {}) {
  const end = now + days * DAY;
  const coursesById = new Map(courses.map(course => [Number(course.id), course]));
  const assignments = assignmentRows(coursesById, assignmentPayload, statuses, baseUrl, now, end);
  return deadlineSummary([...assignments, ...eventRows(coursesById, events, assignmentPayload, now, end)]);
}

async function mapLimit(values, limit, operation) {
  const results = new Array(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await operation(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
  return results;
}

async function collectEvents(client, from, to) {
  const events = [], warnings = [];
  let afterEventId = 0;
  for (let page = 0; page < MAX_EVENT_PAGES; page += 1) {
    const payload = await client.getUpcomingDeadlines({ from, to, limit: EVENT_PAGE_SIZE, afterEventId });
    events.push(...(payload.events ?? []));
    warnings.push(...(payload.warnings ?? []));
    if ((payload.events?.length ?? 0) < EVENT_PAGE_SIZE) return { events, warnings, complete: true, pages: page + 1 };
    const next = Number(payload.lastid ?? payload.events?.at(-1)?.id);
    if (!next || next === afterEventId) return { events, warnings: [...warnings, { message: 'Deadline cursor did not advance.' }], complete: false, pages: page + 1 };
    afterEventId = next;
  }
  return { events, warnings: [...warnings, { message: 'Deadline page limit reached.' }], complete: false, pages: MAX_EVENT_PAGES };
}

function selectCourses(courses, requested, cap = 12) {
  const visible = courses.filter(course => course.visible !== false);
  if (requested?.length) {
    const wanted = new Set(requested.map(Number));
    const selected = visible.filter(course => wanted.has(Number(course.id)));
    const missing = [...wanted].filter(id => !selected.some(course => Number(course.id) === id));
    if (missing.length) throw new Error(`Requested course IDs are not visible: ${missing.join(', ')}`);
    return { selected, truncated: false };
  }
  const sorted = [...visible].sort((a, b) => asNumber(b.startdate) - asNumber(a.startdate));
  return { selected: sorted.slice(0, cap), truncated: sorted.length > cap };
}

export async function collectStudySnapshot(client, { courseIds = [], days = 14, includeContents = false } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const site = await client.getSiteInfo();
  if (!site.userid) throw new Error('Cannot scope study state without the current Moodle user ID.');
  const allCourses = await client.listCourses();
  const { selected, truncated } = selectCourses(allCourses, courseIds);
  const selectedIds = selected.map(course => Number(course.id));
  const assignmentPayload = selectedIds.length ? await client.listAssignments(selectedIds) : { courses: [], warnings: [] };
  const from = now - OVERDUE_DAYS * DAY;
  const eventResult = await collectEvents(client, from, now + days * DAY);
  const assignments = (assignmentPayload.courses ?? []).flatMap(course => (course.assignments ?? []).map(assignment => ({ ...assignment, course_id: Number(course.id) })));
  const statusCandidates = assignments.filter(assignment => {
    const due = asNumber(assignment.duedate) || asNumber(assignment.cutoffdate);
    return !due || (due >= from && due <= now + days * DAY);
  }).sort((a,b) => {
    const aDue = asNumber(a.duedate) || asNumber(a.cutoffdate) || Infinity;
    const bDue = asNumber(b.duedate) || asNumber(b.cutoffdate) || Infinity;
    return aDue - bDue;
  }).slice(0, MAX_STATUS_CHECKS);
  const statuses = new Map(), statusWarnings = [];
  await mapLimit(statusCandidates, 4, async assignment => {
    try { statuses.set(Number(assignment.id), await client.getSubmissionStatus(Number(assignment.id))); }
    catch (error) { statusWarnings.push({ assignment_id: Number(assignment.id), message: String(error.message) }); }
  });
  const radar = buildDeadlineRadar({ courses: selected, assignmentPayload, events: eventResult.events, statuses, baseUrl: client.baseUrl, now, days });
  const contents = new Map(), contentWarnings = [];
  if (includeContents) await mapLimit(selected, 3, async course => {
    try { contents.set(Number(course.id), await client.getCourseContents(Number(course.id))); }
    catch (error) { contentWarnings.push({ course_id: Number(course.id), message: String(error.message) }); }
  });
  const scope = studyScope(client.baseUrl, site.userid);
  return {
    now,
    site: { userid: site.userid, sitename: site.sitename, siteurl: site.siteurl },
    scope,
    courses: selected,
    radar,
    contents,
    coverage: {
      course_count: selected.length,
      course_selection_truncated: truncated,
      assignment_warnings: assignmentPayload.warnings ?? [],
      submission_status_checked: statuses.size,
      submission_status_cap: MAX_STATUS_CHECKS,
      submission_status_warnings: statusWarnings,
      calendar_complete: eventResult.complete,
      calendar_pages: eventResult.pages,
      calendar_warnings: eventResult.warnings,
      course_content_warnings: contentWarnings,
    },
  };
}

const completionState = module => asNumber(module?.completiondata?.state ?? module?.completiondata?.completionstate);
const minutesFor = kind => ({ assign: 60, assignment: 60, quiz: 35, workshop: 45, resource: 25, file: 25, page: 20, book: 30, url: 15 }[kind] ?? 30);
const verbFor = kind => ['resource', 'file', 'page', 'book', 'url', 'folder'].includes(kind) ? '阅读' : '完成';

function courseworkItems(courses, contents, radar, progress) {
  const deadlineNames = new Set(radar.rows.map(row => `${row.course_id}:${normalizedName(row.item)}`));
  const items = [];
  for (const course of courses) {
    let taken = 0;
    for (const section of contents.get(Number(course.id)) ?? []) {
      if (section.visible === false) continue;
      for (const module of section.modules ?? []) {
        if (taken >= 3) break;
        if (module.visible === false || completionState(module) > 0) continue;
        const key = `${course.id}:${normalizedName(module.name)}`;
        if (deadlineNames.has(key)) continue;
        const kind = text(module.modname || 'activity').toLowerCase();
        const id = `module:${Number(module.id)}`;
        if (progress.items?.[id]?.completed) continue;
        items.push({ id, course_id: Number(course.id), course: courseName(course), title: text(module.name) || `Module ${module.id}`,
          kind, verb: verbFor(kind), minutes: minutesFor(kind), due_at: null, due_iso: null,
          url: text(module.url) || null, first_step: kind === 'assign' || kind === 'quiz' ? firstStep(kind) : '打开材料，先看标题、目录和完成要求。',
          source: `Moodle course section: ${text(section.name) || section.section || 'unnamed'}` });
        taken += 1;
      }
      if (taken >= 3) break;
    }
  }
  return items;
}

function dateKey(seconds) {
  const d = new Date(seconds * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function evaluateStudyState({ radar, remainingItems = [], mood = null, now = Math.floor(Date.now() / 1000) }) {
  const due72 = radar.rows.filter(row => !row.overdue && row.due_at && row.due_at <= now + 72 * 3600).length;
  const overdue = radar.counts.overdue;
  const moodPressure = ['overloaded', 'sick', 'stuck'].includes(mood);
  let label = 'steady';
  if (overdue || due72 >= 3 || moodPressure) label = 'overloaded';
  else if (due72 >= 1 || remainingItems.length >= 8 || mood === 'tired') label = 'at_risk';
  const top = radar.most_urgent ?? remainingItems[0] ?? null;
  const advice = label === 'overloaded'
    ? `先只保住最近的一件：${top?.course ? `${top.course} ` : ''}${top?.item || top?.title || '核对最近截止事项'}。完成第一步后再重排其余任务。`
    : label === 'at_risk'
      ? `今天先完成 ${top?.course ? `${top.course} ` : ''}${top?.first_step || '最早截止事项的第一步'}，不要同时开三个战场。`
      : top
        ? `进度正常；下一步是 ${top.course ? `${top.course} ` : ''}${top.first_step || top.title || top.item}。`
        : '目前没有识别到紧急任务；用课程页面核对是否存在未进入 Moodle 日历的要求。';
  return { label, mood, overdue, due_within_72_hours: due72, remaining_items: remainingItems.length, advice };
}

export function buildWeeklyPlan({ courses = [], contents = new Map(), radar, progress = { items: {} }, now = Math.floor(Date.now() / 1000), days = 7 } = {}) {
  const deadlineItems = radar.rows.filter(row => !row.overdue && !progress.items?.[row.id]?.completed)
    .map(row => ({ id: row.id, course_id: row.course_id, course: row.course, title: row.item, kind: row.kind,
      verb: '完成', minutes: minutesFor(row.kind), due_at: row.due_at, due_iso: row.due_iso, url: row.url,
      first_step: row.first_step, source: row.source, pending_confirmation: row.pending_confirmation }));
  const items = [...deadlineItems, ...courseworkItems(courses, contents, radar, progress)]
    .sort((a, b) => ((a.due_at ?? Infinity) - (b.due_at ?? Infinity)) || a.course.localeCompare(b.course) || a.title.localeCompare(b.title));
  const schedule = Array.from({ length: days }, (_, index) => ({
    date: dateKey(now + index * DAY),
    must: null,
    should: [],
    total_minutes: 0,
  }));
  for (const item of items) {
    let preferred = 0;
    if (item.due_at) preferred = Math.max(0, Math.min(days - 1, Math.floor((item.due_at - now) / DAY) - 1));
    let target = schedule.findIndex((day, index) => index <= preferred && day.total_minutes + item.minutes <= 120);
    if (target < 0) target = schedule.findIndex(day => day.total_minutes + item.minutes <= 120);
    if (target < 0) target = days - 1;
    const day = schedule[target];
    if (!day.must) day.must = item;
    else day.should.push(item);
    day.total_minutes += item.minutes;
  }
  const state = evaluateStudyState({ radar, remainingItems: items, mood: progress.mood?.value ?? null, now });
  return {
    generated_at: new Date(now * 1000).toISOString(),
    range: { from: schedule[0]?.date ?? null, to: schedule.at(-1)?.date ?? null, days },
    top_one: items[0] ?? null,
    courses: courses.map(course => ({ id: Number(course.id), code: courseName(course), fullname: course.fullname })),
    items,
    days: schedule,
    state,
    limitations: 'The plan uses visible Moodle deadlines, completion metadata and the first incomplete visible course items. It cannot see requirements kept only inside unread files or external systems.',
  };
}

const emptyState = () => ({ schema: 1, updated_at: null, mood: null, items: {} });
export async function readStudyState(directory, scope) {
  const path = join(directory, `${scope}.json`);
  try {
    const state = JSON.parse(await readFile(path, 'utf8'));
    if (state.schema !== 1 || !state.items || typeof state.items !== 'object') throw new Error('Study state schema is invalid.');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return emptyState();
    throw error;
  }
}

async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 }); await rename(temporary, path); }
  finally { await unlink(temporary).catch(() => {}); }
}

export async function updateStudyState(directory, scope, { action, itemId, mood, note }) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, `${scope}.json`), lockPath = `${path}.lock`;
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('Study state is busy. Inspect a leftover lock after a crash before removing it.'); throw error; }
  try {
    const state = await readStudyState(directory, scope);
    const now = new Date().toISOString();
    if (action === 'complete' || action === 'reopen') {
      if (!text(itemId)) throw new Error(`${action} requires item_id.`);
      state.items[itemId] = { completed: action === 'complete', updated_at: now, note: text(note) || null };
    } else if (action === 'mood') {
      if (!text(mood)) throw new Error('mood requires a mood value.');
      state.mood = { value: mood, updated_at: now, note: text(note) || null };
    } else if (action === 'clear_mood') state.mood = null;
    else throw new Error(`Unsupported study action: ${action}`);
    state.updated_at = now;
    await atomicJson(path, state);
    return { state, path, mood: state.mood, item: itemId ? state.items[itemId] : null };
  } finally { await lock.close(); await unlink(lockPath); }
}

const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
function safeLink(url, label) {
  try { const parsed = new URL(url); return parsed.protocol === 'https:' ? `<a href="${esc(parsed.toString())}">${esc(label)}</a>` : esc(label); }
  catch { return esc(label); }
}

export function renderStudyDashboard(radar, plan) {
  const rows = radar.rows.map(row => `<tr><td>${esc(row.course)}</td><td>${safeLink(row.url, row.item)}</td><td>${esc(row.due_iso || '待确认')}</td><td>${esc(row.overdue ? '已过期' : row.pending_confirmation ? '待确认' : '未完成')}</td></tr>`).join('');
  const days = plan.days.map(day => `<section><h3>${esc(day.date)}</h3><p><strong>必做：</strong>${day.must ? esc(`${day.must.course} ${day.must.title}`) : '暂无'}</p>${day.should.length ? `<ul>${day.should.map(item => `<li>${esc(`${item.course} ${item.title}`)}</li>`).join('')}</ul>` : ''}</section>`).join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Moodle 学习看板</title><style>body{font:16px/1.55 system-ui,sans-serif;max-width:1050px;margin:auto;padding:24px;color:#242424;background:#fffaf5}h1,h2{color:#9b3d00}table{width:100%;border-collapse:collapse;background:white}th,td{padding:10px;border:1px solid #e7d8ca;text-align:left;vertical-align:top}.status{padding:14px;border-left:5px solid #f98012;background:white}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}section{background:white;padding:12px;border:1px solid #eadccf;border-radius:8px}a{color:#9b3d00}</style></head><body><h1>Moodle 学习看板</h1><p class="status"><strong>${esc(plan.state.label)}</strong>：${esc(plan.state.advice)}</p><h2>截止日期雷达</h2><table><thead><tr><th>课程</th><th>事项</th><th>时间</th><th>状态</th></tr></thead><tbody>${rows || '<tr><td colspan="4">当前没有识别到事项。</td></tr>'}</tbody></table><h2>本周计划</h2><main>${days}</main><p>生成时间：${esc(plan.generated_at)}。请在 Moodle 原页面核对重要日期。</p></body></html>`;
}

export async function writeStudyDashboard(directory, scope, radar, plan) {
  const target = join(directory, scope);
  await mkdir(target, { recursive: true });
  const htmlPath = join(target, 'study-dashboard.html');
  const jsonPath = join(target, 'study-dashboard.json');
  const htmlTemporary = `${htmlPath}.${randomUUID()}.tmp`;
  try { await writeFile(htmlTemporary, renderStudyDashboard(radar, plan), { flag: 'wx', mode: 0o600 }); await rename(htmlTemporary, htmlPath); }
  finally { await unlink(htmlTemporary).catch(() => {}); }
  await atomicJson(jsonPath, { schema: 1, radar, plan });
  return { html_path: htmlPath, json_path: jsonPath };
}
