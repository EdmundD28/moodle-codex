# Moodle for Codex setup

This plugin uses Moodle's official Web Services REST endpoint. It is read-only.

Requires Node.js 22.13 or later (tested on Node.js 24.19). All Moodle actions remain read-only; downloads and change snapshots write only local files.

## Capability groups

- Files: list_course_files, read_course_file, download_course_file. PDF text pages and UTF-8 source/text are supported. ZIPs can be listed and selected source members read without extraction or execution. Downloads require same-origin HTTPS Moodle pluginfile URLs freshly returned by the course API; redirects are rejected.
- Feedback: list_course_forums, list_forum_discussions, get_forum_posts, get_assignment_feedback, get_grading_definition. Permissions remain server-controlled. Rubric definitions are optional; access denial must be reported, not bypassed.
- Changes: check_course_changes creates a persistent local baseline and compares course descriptions, file metadata, and assignment deadlines. Partial assignment reads preserve the last valid assignment baseline. Missing resources are reported as no longer visible, not deleted. It does not compare binary file contents or schedule background runs.
- Optional MOODLE_DATA_DIR sets the local download/snapshot root; default is ~/Documents/Codex/moodle-codex-data. Snapshots may include private course text and are isolated by Moodle site, user and course. Keep this directory private. A leftover snapshot .lock after an interrupted process must be inspected before removing it.
- check_connection returns build and feature_set=stages-1-4 so a newly loaded installation can be distinguished from a stale task.

Optional read-only API functions for forums and rubric definitions:

- mod_forum_get_forums_by_courses
- mod_forum_get_forum_discussions
- mod_forum_get_discussion_posts
- core_grading_get_definitions

Limits: 20 MiB download, 15-second parser deadline, 128 MiB worker heap, 5 PDF pages/request, 50,000 characters/page or text slice, 2 MiB text/source member, 2000 ZIP entries and 50 MiB total declared ZIP expansion. Scanned PDFs require OCR elsewhere; no image interpretation is claimed.

Validation: `npm test` uses synthetic fixtures and makes no Moodle requests. `npm run verify:live` selects the newest visible course by default and exercises available read-only capabilities through the MCP transport. Set `MOODLE_VERIFY_COURSE` to a course-name regular expression when you need a specific course. It prints bounded counts and status only, uses an isolated local data directory by default, and makes no Moodle writes.

API references: https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/mod/forum/externallib.php and https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/lib/classes/grading_external.php.

## Required values

- MOODLE_BASE_URL: the root URL of the Moodle site, for example https://moodle.example.edu
- MOODLE_TOKEN: a Web Services token issued by that Moodle site
- MOODLE_TIMEOUT_MS: optional request timeout from 1000 to 120000 milliseconds

## Standalone UNSW setup GUI

Double-click `Setup-Moodle.cmd`, or run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\configure-mobile.ps1
```

The script now owns the complete local setup entrypoint. It generates a fresh alphanumeric passport for the attempt, creates a temporary non-secret status file, opens the UNSW Moodle mobile login URL, and shows a masked input window. After login, copy the complete `moodlemobile://` link from “Click here if the app does not open automatically” and paste it into the GUI. Do not paste the HTTPS address bar URL, an RSS key, a password, or an MFA code.

The GUI validates that the callback belongs to the current attempt, extracts the token only in local memory, verifies `core_webservice_get_site_info`, reports optional missing functions, and saves the verified settings as Windows current-user environment variables. Automatically generated status files are removed when the window closes and never contain the callback or token.

For automated tests, `Setup-Moodle.cmd -SelfTest` exercises the exact double-click launcher through Windows PowerShell 5.1 and validates callback parsing without opening a window, making a network request, or writing settings. `-Passport`, `-StatusPath`, and `-NoBrowser` remain available for controlled integration tests.

## Raw-token fallback

Run scripts/configure.ps1 from PowerShell to enter the URL and token without echoing the token. The script verifies the connection before saving the values as Windows user environment variables. Then fully restart the Codex desktop app so the new process inherits them.

Windows user environment variables are stored for the signed-in user. Do not put the token in this plugin folder, a Git repository, screenshots, or chat messages. Revoke the token in Moodle and remove the MOODLE_TOKEN user environment variable if the token is exposed.

The Moodle administrator must enable Web Services and include these functions in the token's service:

- core_webservice_get_site_info
- core_enrol_get_users_courses
- core_course_get_contents
- mod_assign_get_assignments
- mod_assign_get_submission_status
- core_calendar_get_action_events_by_timesort

After restarting Codex, start a new task and ask: 检查 Moodle 连接.

If the site uses institutional single sign-on and does not expose user tokens, an administrator must issue a restricted token or enable an appropriate service. Do not reuse a browser session cookie as a substitute.
