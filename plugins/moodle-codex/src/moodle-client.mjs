const DEFAULT_TIMEOUT_MS = 30_000;

export const REQUIRED_FUNCTIONS = [
  "core_webservice_get_site_info",
  "core_enrol_get_users_courses",
  "core_course_get_contents",
  "mod_assign_get_assignments",
  "mod_assign_get_submission_status",
  "core_calendar_get_action_events_by_timesort",
];

export const OPTIONAL_READ_FUNCTIONS = [
  "mod_forum_get_forums_by_courses", "mod_forum_get_forum_discussions",
  "mod_forum_get_discussion_posts", "core_grading_get_definitions",
];

export function flattenMoodleParams(params) {
  const body = new URLSearchParams();

  const append = (key, value) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => append(key + "[" + index + "]", item));
      return;
    }
    if (typeof value === "object") {
      Object.entries(value).forEach(([childKey, childValue]) =>
        append(key + "[" + childKey + "]", childValue),
      );
      return;
    }
    body.append(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  };

  Object.entries(params).forEach(([key, value]) => append(key, value));
  return body;
}

export function cleanUrl(value) {
  if (typeof value !== "string") return value;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(ws)?token$/i.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return value;
  }
}

export function redactSecrets(value, secret = "") {
  if (Array.isArray(value)) return value.map(child => redactSecrets(child, secret));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        /^(?:ws)?token$|password|secret/i.test(key) ? "[REDACTED]" : redactSecrets(child, secret),
      ]),
    );
  }
  return typeof value === "string" ? cleanUrl((secret ? value.split(secret).join("[REDACTED]") : value).replace(/((?:ws)?token|password|secret)(\s*[=:]\s*)[^\s&<>"']+/gi, "$1$2[REDACTED]")) : value;
}

export function stripHtml(value, limit = 4_000) {
  if (!value) return "";
  return String(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<\/(?:p|div|tr|h[1-6]|li)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[^\S\n]+/g, " ").replace(/\n[ \t]+/g, "\n").replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit);
}

function requiredString(name, value) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) {
    throw new Error(name + " is not configured. Set it before starting Codex.");
  }
  return normalized;
}

function normalizeBaseUrl(value) {
  const baseUrl = requiredString("MOODLE_BASE_URL", value).replace(/\/+$/, "");
  const parsed = new URL(baseUrl);
  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("MOODLE_BASE_URL must use http or https.");
  }
  return parsed.toString().replace(/\/$/, "");
}

function timeoutFromEnv(value) {
  if (!value) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1_000 || parsed > 120_000) {
    throw new Error("MOODLE_TIMEOUT_MS must be between 1000 and 120000.");
  }
  return parsed;
}

export class MoodleClient {
  constructor({
    baseUrl = process.env.MOODLE_BASE_URL,
    token = process.env.MOODLE_TOKEN,
    timeoutMs = timeoutFromEnv(process.env.MOODLE_TIMEOUT_MS),
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.token = requiredString("MOODLE_TOKEN", token);
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  static configuration() {
    const rawBaseUrl = process.env.MOODLE_BASE_URL?.trim() ?? "";
    let baseUrl = rawBaseUrl;
    let baseUrlValid = false;
    try {
      baseUrl = normalizeBaseUrl(rawBaseUrl);
      baseUrlValid = true;
    } catch {
      // Report configuration state without throwing or exposing the token.
    }
    return {
      configured: baseUrlValid && Boolean(process.env.MOODLE_TOKEN?.trim()),
      base_url: baseUrl,
      base_url_valid: baseUrlValid,
      token_present: Boolean(process.env.MOODLE_TOKEN?.trim()),
    };
  }

  async call(functionName, params = {}) {
    if (![...REQUIRED_FUNCTIONS, ...OPTIONAL_READ_FUNCTIONS].includes(functionName)) throw new Error("Read-only policy rejected function: " + functionName);
    if (["wstoken", "wsfunction", "moodlewsrestformat"].some(key => Object.hasOwn(params, key))) throw new Error("Reserved Moodle request parameter rejected.");
    const endpoint = this.baseUrl + "/webservice/rest/server.php";
    const body = flattenMoodleParams({
      wstoken: this.token,
      wsfunction: functionName,
      moodlewsrestformat: "json",
      ...params,
    });

    let response;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        redirect: "error",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
          "user-agent": "moodle-codex/0.1.0",
        },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new Error("Moodle request failed for " + functionName + ": " + redactSecrets(String(error.message).split(this.token).join("[REDACTED]")));
    }

    if (!response.ok) {
      throw new Error("Moodle HTTP " + response.status + " while calling " + functionName + ".");
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("Moodle returned non-JSON data for " + functionName + ".");
    }

    if (data && typeof data === "object" && (data.exception || data.errorcode)) {
      const code = data.errorcode || data.exception || "moodle_error";
      const message = stripHtml(data.message || "Moodle rejected the request.", 1_000)
        .split(this.token)
        .join("[REDACTED]");
      throw new Error(functionName + " failed (" + code + "): " + message);
    }

    return redactSecrets(data, this.token);
  }

  getSiteInfo() {
    return this.call("core_webservice_get_site_info");
  }

  async listCourses() {
    const site = await this.getSiteInfo();
    if (!site.userid) throw new Error("Moodle site info did not include the current user ID.");
    return this.call("core_enrol_get_users_courses", {
      userid: site.userid,
      returnusercount: false,
    });
  }

  getCourseContents(courseId) {
    return this.call("core_course_get_contents", { courseid: courseId });
  }

  async listAssignments(courseIds = []) {
    let ids = courseIds;
    if (!ids.length) {
      const courses = await this.listCourses();
      ids = courses.map((course) => course.id);
    }
    return this.call("mod_assign_get_assignments", { courseids: ids });
  }

  getSubmissionStatus(assignId) {
    return this.call("mod_assign_get_submission_status", { assignid: assignId });
  }

  getUpcomingDeadlines({ from, to, limit, afterEventId = 0 }) {
    return this.call("core_calendar_get_action_events_by_timesort", {
      timesortfrom: from,
      timesortto: to,
      aftereventid: afterEventId,
      limitnum: limit,
      limittononsuspendedevents: true,
    });
  }
}
