import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  buildDeadlineRadar,
  buildWeeklyPlan,
  collectStudySnapshot,
  evaluateStudyState,
  readStudyState,
  renderStudyDashboard,
  updateStudyState,
  writeStudyDashboard,
} from '../src/study-assistant.mjs';

const now = 1_800_000_000;
const courses = [{ id: 7, shortname: 'MTRN', fullname: 'Robotics', visible: true }];
const assignments = due => ({ courses: [{ id: 7, assignments: [
  { id: 11, cmid: 101, name: 'Report', duedate: due, cutoffdate: due + 3600 },
  { id: 12, cmid: 102, name: 'No date task', duedate: 0, cutoffdate: 0 },
  { id: 13, cmid: 103, name: 'Already submitted', duedate: due + 7200 },
] }] });

test('deadline radar merges events, removes duplicate assignment events and preserves uncertainty', () => {
  const due = now + 2 * 86_400;
  const statuses = new Map([
    [11, { lastattempt: { submission: { status: 'new' } } }],
    [12, { lastattempt: { submission: { status: 'new' } } }],
    [13, { lastattempt: { submission: { status: 'submitted', timemodified: now } } }],
  ]);
  const radar = buildDeadlineRadar({
    courses,
    assignmentPayload: assignments(due),
    statuses,
    baseUrl: 'https://moodle.example',
    now,
    days: 14,
    events: [
      { id: 90, instance: 11, modulename: 'assign', name: 'Report', timesort: due, course: { id: 7, shortname: 'MTRN' } },
      { id: 92, instance: 13, modulename: 'assign', name: 'Already submitted', timesort: due + 7200, course: { id: 7, shortname: 'MTRN' } },
      { id: 91, modulename: 'quiz', name: 'Quiz 1', timesort: now + 3600, course: { id: 7, shortname: 'MTRN' }, action: { url: 'https://moodle.example/mod/quiz/view.php?id=4' } },
      { id: 93, modulename: 'quiz', name: 'Other course quiz', timesort: now + 7200, course: { id: 99, shortname: 'OTHER' } },
    ],
  });
  assert.deepEqual(radar.rows.map(row => row.id), ['event:91', 'assignment:11', 'assignment:12']);
  assert.equal(radar.most_urgent.item, 'Quiz 1');
  assert.equal(radar.counts.undated, 1);
  assert.equal(radar.rows.find(row => row.id === 'assignment:12').pending_confirmation, true);
  assert.equal(radar.rows.filter(row => row.item === 'Report').length, 1);
});

test('weekly plan filters completed items, schedules bounded days and reacts to mood', () => {
  const radar = buildDeadlineRadar({ courses, assignmentPayload: assignments(now + 2 * 86_400), statuses: new Map(), baseUrl: 'https://moodle.example', now, days: 14 });
  const contents = new Map([[7, [{ id: 1, name: 'Week 1', visible: true, modules: [
    { id: 21, name: 'Lecture notes', modname: 'resource', visible: true, completiondata: { state: 0 }, url: 'https://moodle.example/mod/resource/view.php?id=21' },
    { id: 22, name: 'Completed quiz', modname: 'quiz', visible: true, completiondata: { state: 1 } },
  ] }]]]);
  const progress = { mood: { value: 'tired' }, items: { 'assignment:12': { completed: true } } };
  const plan = buildWeeklyPlan({ courses, contents, radar, progress, now, days: 7 });
  assert.equal(plan.days.length, 7);
  assert.ok(plan.items.some(item => item.id === 'module:21'));
  assert.ok(!plan.items.some(item => item.id === 'module:22'));
  assert.ok(!plan.items.some(item => item.id === 'assignment:12'));
  assert.equal(plan.state.label, 'at_risk');
  assert.ok(plan.days.some(day => day.must));
});

test('study state is local, atomic and scoped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'moodle-study-state-'));
  const first = await updateStudyState(dir, 'account-a', { action: 'complete', itemId: 'assignment:11', note: 'draft uploaded locally' });
  assert.equal(first.item.completed, true);
  await updateStudyState(dir, 'account-a', { action: 'mood', mood: 'motivated' });
  assert.equal((await readStudyState(dir, 'account-a')).mood.value, 'motivated');
  assert.deepEqual((await readStudyState(dir, 'account-b')).items, {});
  await assert.rejects(updateStudyState(dir, 'account-a', { action: 'complete' }), /item_id/);
});

test('dashboard escapes Moodle content and writes inspectable HTML plus JSON', async () => {
  const radar = {
    rows: [{ course: '<Course>', item: '<script>alert(1)</script>', due_iso: null, overdue: false, pending_confirmation: true, url: 'javascript:alert(1)' }],
    counts: { total: 1, upcoming: 0, overdue: 0, undated: 1, pending_confirmation: 1 },
  };
  const plan = { generated_at: '2027-01-15T08:00:00.000Z', state: { label: 'steady', advice: '<b>safe</b>' }, days: [{ date: '2027-01-15', must: null, should: [] }] };
  const html = renderStudyDashboard(radar, plan);
  assert.doesNotMatch(html, /<script>|javascript:/);
  assert.match(html, /&lt;script&gt;/);
  const dir = await mkdtemp(join(tmpdir(), 'moodle-study-dashboard-'));
  const files = await writeStudyDashboard(dir, 'account-a', radar, plan);
  assert.match(await readFile(files.html_path, 'utf8'), /Moodle 学习看板/);
  assert.equal(JSON.parse(await readFile(files.json_path, 'utf8')).schema, 1);
});

test('status becomes overloaded for overdue work even when mood is calm', () => {
  const state = evaluateStudyState({ radar: { rows: [{ overdue: true }], counts: { overdue: 1 }, most_urgent: { course: 'MTRN', item: 'Report' } }, remainingItems: [], mood: 'steady', now });
  assert.equal(state.label, 'overloaded');
  assert.match(state.advice, /Report/);
});

test('live snapshot adapter uses only the existing client and reports bounded coverage', async () => {
  const calls = [];
  const client = {
    baseUrl: 'https://moodle.example',
    getSiteInfo: async () => { calls.push('site'); return { userid: 5, sitename: 'Example' }; },
    listCourses: async () => { calls.push('courses'); return courses; },
    listAssignments: async ids => { calls.push(['assignments', ids]); return assignments(now + 86_400); },
    getUpcomingDeadlines: async args => { calls.push(['events', args]); return { events: [], warnings: [] }; },
    getSubmissionStatus: async id => { calls.push(['status', id]); return { lastattempt: { submission: { status: id === 13 ? 'submitted' : 'new' } } }; },
    getCourseContents: async id => { calls.push(['contents', id]); return []; },
  };
  const snapshot = await collectStudySnapshot(client, { courseIds: [7], days: 14, includeContents: true });
  assert.equal(snapshot.scope.length, 32);
  assert.equal(snapshot.coverage.calendar_complete, true);
  assert.equal(snapshot.coverage.course_count, 1);
  assert.deepEqual(calls.find(call => Array.isArray(call) && call[0] === 'assignments')[1], [7]);
  assert.ok(calls.some(call => Array.isArray(call) && call[0] === 'contents'));
  assert.ok(snapshot.radar.rows.every(row => row.course_id === 7));
});
