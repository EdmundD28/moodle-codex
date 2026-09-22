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
        "get_forum_posts",
        "get_grading_definition",
        "get_site_info",
        "get_submission_status",
        "get_upcoming_deadlines",
        "list_assignments",
        "list_course_files",
        "list_course_forums",
        "list_courses",
        "list_forum_discussions",
        "read_course_file",
      ],
    );
    const localWriters = new Set(["check_course_changes", "download_course_file"]);
    for (const tool of listed.tools) {
      assert.equal(
        tool.annotations?.readOnlyHint,
        !localWriters.has(tool.name),
        tool.name + " has the wrong readOnlyHint",
      );
    }
    assert.ok(listed.tools.every((tool) => tool.annotations?.destructiveHint === false));

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
