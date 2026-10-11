import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const pluginRoot = fileURLToPath(new URL("../", import.meta.url));

test("MCP server advertises the intended Moodle-read-only tools and declares local writes", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["server.mjs"],
    cwd: pluginRoot,
    env: {
      ...process.env,
      MOODLE_BASE_URL: "",
      MOODLE_TOKEN: "",
    },
  });
  const client = new Client({ name: "moodle-codex-test", version: "0.1.0" });

  await client.connect(transport);
  try {
    const listed = await client.listTools();
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [
        "check_connection",
        "check_course_changes",
        "download_course_file",
        "get_assignment_feedback",
        "get_course_contents",
        "get_deadline_radar",
        "get_forum_posts",
        "get_grading_definition",
        "get_site_info",
        "get_submission_status",
        "get_upcoming_deadlines",
        "get_weekly_study_plan",
        "list_assignments",
        "list_course_files",
        "list_course_forums",
        "list_courses",
        "list_forum_discussions",
        "read_course_file",
        "record_study_progress",
        "write_study_dashboard",
      ],
    );
    const localWriters = new Set(["check_course_changes", "download_course_file", "record_study_progress", "write_study_dashboard"]);
    for (const tool of listed.tools) {
      assert.equal(
        tool.annotations?.readOnlyHint,
        !localWriters.has(tool.name),
        tool.name + " has the wrong readOnlyHint",
      );
      assert.equal(tool.annotations?.destructiveHint, false, tool.name + " must not be destructive");
      assert.equal(tool.annotations?.idempotentHint, !localWriters.has(tool.name), tool.name + " has the wrong idempotentHint");
      assert.equal(tool.annotations?.openWorldHint, true, tool.name + " accesses Moodle");
      assert.equal(tool.inputSchema?.type, "object", tool.name + " must publish an object input schema");
      assert.ok(tool.inputSchema.properties, tool.name + " must publish input properties");
    }

    // Invalid inputs must fail at the MCP boundary, before configuration or network access.
    for (const [name, args] of [
      ["get_course_contents", { course_id: -1 }],
      ["read_course_file", { course_id: 1, file_id: "https://example.invalid/file.pdf" }],
      ["record_study_progress", { action: "submit" }],
    ]) {
      const rejected = await client.callTool({ name, arguments: args });
      assert.equal(rejected.isError, true, name + " must reject invalid input");
      assert.match(rejected.content[0].text, /Input validation error/);
    }

    const result = await client.callTool({
      name: "check_connection",
      arguments: { probe: false },
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.configuration.configured, false);
    assert.equal(result.structuredContent.configuration.token_present, false);
  } finally {
    await client.close();
  }
});
