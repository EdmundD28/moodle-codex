import assert from "node:assert/strict";
import test from "node:test";

import {
  cleanUrl,
  flattenMoodleParams,
  MoodleClient,
  redactSecrets,
} from "../src/moodle-client.mjs";

test("flattens nested Moodle REST parameters", () => {
  const body = flattenMoodleParams({
    courseids: [12, 34],
    options: { userevents: true, limit: 5 },
  });
  assert.equal(body.get("courseids[0]"), "12");
  assert.equal(body.get("courseids[1]"), "34");
  assert.equal(body.get("options[userevents]"), "1");
  assert.equal(body.get("options[limit]"), "5");
});

test("redacts tokens from nested objects and URLs", () => {
  const value = redactSecrets({
    token: "top-secret",
    fileurl: "https://moodle.example/file?token=abc&id=7",
  });
  assert.equal(value.token, "[REDACTED]");
  assert.equal(value.fileurl, "https://moodle.example/file?token=%5BREDACTED%5D&id=7");
  assert.equal(cleanUrl("not a URL"), "not a URL");
});

test("calls Moodle REST with a POST body and returns JSON", async () => {
  let request;
  const client = new MoodleClient({
    baseUrl: "https://moodle.example/",
    token: "secret-token",
    fetchImpl: async (url, init) => {
      request = { url, init };
      return { ok: true, json: async () => ({ sitename: "Example" }) };
    },
  });

  const result = await client.call("core_webservice_get_site_info");
  assert.equal(result.sitename, "Example");
  assert.equal(request.url, "https://moodle.example/webservice/rest/server.php");
  assert.equal(request.init.method, "POST");
  assert.equal(request.init.body.get("wstoken"), "secret-token");
  assert.equal(request.init.body.get("wsfunction"), "core_webservice_get_site_info");
});

test("rejects unsafe Moodle base URLs before sending credentials", () => {
  for (const baseUrl of [
    "http://moodle.example",
    "https://user:pass@moodle.example",
    "https://moodle.example/?redirect=https://evil.example",
    "https://moodle.example/#fragment",
  ]) {
    assert.throws(
      () => new MoodleClient({ baseUrl, token: "secret-token", fetchImpl: async () => assert.fail("network called") }),
      /MOODLE_BASE_URL/,
    );
  }
});

test("turns Moodle exceptions into bounded errors without exposing the token", async () => {
  const client = new MoodleClient({
    baseUrl: "https://moodle.example",
    token: "secret-token",
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        exception: "moodle_exception",
        errorcode: "invalidtoken",
        message: "Invalid token secret-token",
      }),
    }),
  });

  let caught;
  try {
    await client.call("core_webservice_get_site_info");
  } catch (error) {
    caught = error;
  }
  assert.match(caught.message, /invalidtoken/);
  assert.doesNotMatch(caught.message, /secret-token/);
});

test("listCourses resolves the current user before requesting courses", async () => {
  const calls = [];
  const client = new MoodleClient({
    baseUrl: "https://moodle.example",
    token: "secret-token",
    fetchImpl: async (_url, init) => {
      const fn = init.body.get("wsfunction");
      calls.push(fn);
      if (fn === "core_webservice_get_site_info") {
        return { ok: true, json: async () => ({ userid: 42 }) };
      }
      assert.equal(init.body.get("userid"), "42");
      return { ok: true, json: async () => [{ id: 9, fullname: "Robotics" }] };
    },
  });

  const courses = await client.listCourses();
  assert.deepEqual(calls, [
    "core_webservice_get_site_info",
    "core_enrol_get_users_courses",
  ]);
  assert.equal(courses[0].fullname, "Robotics");
});

test("deadlines use the Moodle action-event API and numeric boolean parameters", async () => {
  const client = new MoodleClient({
    baseUrl: "https://moodle.example",
    token: "secret-token",
    fetchImpl: async (_url, init) => {
      assert.equal(init.body.get("wsfunction"), "core_calendar_get_action_events_by_timesort");
      assert.equal(init.body.get("limittononsuspendedevents"), "1");
      assert.equal(init.body.get("timesortfrom"), "100");
      assert.equal(init.body.get("timesortto"), "200");
      return { ok: true, json: async () => ({ events: [] }) };
    },
  });
  assert.deepEqual(await client.getUpcomingDeadlines({ from: 100, to: 200, limit: 10 }), { events: [] });
});
