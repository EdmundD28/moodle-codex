<p align="center">
  <img src="plugins/moodle-codex/assets/logo.png" alt="Moodle for Codex" width="128">
</p>

# Moodle for Codex

A local-first, read-only Codex plugin for inspecting Moodle courses, assignments, deadlines, files, forums, feedback, rubrics, and course changes through Moodle's official Web Services API.

The project is deliberately narrow: it reads authorized data and can save downloads or change snapshots locally. It cannot submit work, post messages, enrol users, change grades, or silently fall back to browser scraping.

## What it demonstrates

| Capability | Tools |
| --- | --- |
| Connection and courses | `check_connection`, `get_site_info`, `list_courses`, `get_course_contents` |
| Assessment | `list_assignments`, `get_submission_status`, `get_upcoming_deadlines`, `get_assignment_feedback`, `get_grading_definition` |
| Files | `list_course_files`, `read_course_file`, `download_course_file` |
| Discussions | `list_course_forums`, `list_forum_discussions`, `get_forum_posts` |
| Change tracking | `check_course_changes` |

Every remote tool is annotated read-only. Local downloads are content-addressed `.bin` files. PDF, text/source, and ZIP parsing runs with strict size, time, path, and memory limits.

## Architecture

```text
Codex / ChatGPT desktop
        │ MCP over stdio
        ▼
plugins/moodle-codex/server.mjs
        ├── fixed read-only tool allowlist
        ├── MoodleClient ── HTTPS POST ── Moodle Web Services
        ├── bounded parser worker ── PDF / UTF-8 text / ZIP
        └── local state ── downloads and per-user course snapshots
```

The repository is also a Codex marketplace. `.agents/plugins/marketplace.json` points to the plugin package at `plugins/moodle-codex`.

## Reproduce it on Windows

Prerequisites: Git, Windows PowerShell 5.1 or PowerShell 7, Node.js 22.13 or later, and a Codex or ChatGPT desktop build that supports plugins.

```powershell
git clone https://github.com/EdmundD28/moodle-codex.git
cd moodle-codex
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1
```

The bootstrap installs exactly the versions in `package-lock.json` and runs the offline test suite. It does not ask for or store Moodle credentials.

For UNSW Moodle, launch the standalone secure setup window by double-clicking:

```text
plugins\moodle-codex\Setup-Moodle.cmd
```

Or start the same GUI from Windows PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\plugins\moodle-codex\scripts\configure-mobile.ps1
```

The GUI separates **Obtain token** from **Setup plugin**. It generates a fresh per-attempt correlation value and accepts the complete `moodlemobile://` callback in a masked local field. It does not open Moodle automatically; use **Open UNSW Moodle sign-in** only when you want to launch the tested UNSW sign-in flow. Other institutions are not claimed to support this flow. The GUI verifies that the callback belongs to the current attempt and probes Moodle before saving `MOODLE_BASE_URL` and `MOODLE_TOKEN` as current-user environment variables. The callback and token are never written to the repository or shown in the console.

### Get a UNSW Moodle token manually

This is the complete flow that was tested with UNSW Moodle. Use your own UNSW account. Never share the callback link, token, password, MFA code, or authenticated browser session.

1. **Start a clean Moodle login.** Open UNSW Moodle in the browser you intend to use, sign out from the current Moodle session, and leave that browser open. Signing out here does not revoke an existing API token; it makes the following mobile-login request pass through a fresh sign-in.

2. **Open the local setup window.** Double-click `plugins\moodle-codex\Setup-Moodle.cmd`. The window creates a new random `passport` for this attempt. A passport is only a request correlation value, not a password or token. Keep this setup window open until the flow is complete.

3. **Register the mobile-login request.** Click **Open UNSW Moodle sign-in** once. The browser opens a URL equivalent to:

   ```text
   https://moodle.telt.unsw.edu.au/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=<random-value>&urlscheme=moodlemobile&confirmed=1&oauthsso=0
   ```

   Do not edit or reuse the generated `passport`. The setup window already holds the matching value for this attempt.

4. **If the page reports `Plugin not enabled or configured`, continue in the same browser session.** In the same tab, open:

   ```text
   https://moodle.telt.unsw.edu.au/login/index.php
   ```

   The tested UNSW flow stored the pending mobile-login request in the browser before showing that error. Changing browser, using a private window, clearing cookies, or waiting too long can lose that pending request.

5. **Complete the UNSW sign-in.** Choose the university sign-in option, select **Agree and sign on to Moodle**, and complete any required account or MFA prompts yourself. After authentication, wait for Moodle to redirect. Do not navigate to Dashboard or a course while the redirect is in progress.

6. **Copy the callback link.** On the page showing **Your registration has been confirmed**, right-click **Click here if the app does not open automatically** and choose **Copy link address**. The copied value must begin with:

   ```text
   moodlemobile://token=
   ```

   Do not copy the `https://` URL from the browser address bar. Clicking the callback may appear to do nothing when no Moodle app is registered for the `moodlemobile://` protocol; copying its link address is sufficient.

7. **Verify and save locally.** Return to the setup window, paste the complete `moodlemobile://token=...` link into the masked field, and click **Verify and save**. The script checks that the callback belongs to this login attempt, calls Moodle's official API to verify it, and saves the resulting settings only for the current Windows user. Treat the operation as successful only when the window says **Connected and saved**.

8. **Restart and verify Codex.** Fully exit and reopen Codex so the new process inherits the saved environment variables. Install or enable the plugin, start a new task, and ask:

   ```text
   检查 Moodle 连接，并列出我的课程。
   ```

The official mobile-service token can have broader permissions than this plugin exposes. This plugin deliberately calls only its fixed read-only tool set, but that does not make the underlying token itself read-only. Revoke it through Moodle and remove the `MOODLE_TOKEN` user environment variable if the callback or token is ever exposed.

If the process fails, close the setup window and start again so it generates a new passport. Do not reuse an old callback, substitute an RSS key, or send credentials through an issue, screenshot, chat, or Git commit.

For another Moodle site, or when an administrator has issued a raw restricted Web Services token, use the terminal fallback:

```powershell
pwsh -File .\plugins\moodle-codex\scripts\configure.ps1 -BaseUrl 'https://moodle.example.edu'
```

Register this clone as a local marketplace:

```powershell
codex plugin marketplace add .
```

Then fully restart the desktop app, open the Plugins Directory, select **Moodle for Codex**, and install/enable **Moodle for Codex**. Start a new task and ask:

```text
检查 Moodle 连接，并告诉我 connected、build 和 feature_set。
```

Configuration saved is not the same as a live connection. Treat the setup as complete only when `connected` is true and the returned build matches the manifest.

For macOS or Linux, run `npm ci` and `npm test` inside `plugins/moodle-codex`, export the same environment variables through your normal secure shell/profile mechanism, and add the repository as a local marketplace.

## Repeatable demo

The offline demonstration is deterministic and makes no Moodle requests:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap.ps1
```

With credentials configured, the live verifier selects the newest visible course by default and exercises only capabilities available to that account:

```powershell
cd .\plugins\moodle-codex
npm run verify:live
```

To target a course, set a local regular expression first:

```powershell
$env:MOODLE_VERIFY_COURSE = 'MTRN|Robotics'
npm run verify:live
```

The live verifier reports bounded status and counts. It does not prove access to invisible material, interpret scanned PDF images, or perform Moodle writes. See [the demo runbook](docs/DEMO.md) for a short presentation flow.

## Known setup traps

- A successful token save does not update an already-running desktop process. Fully restart it and begin a new task.
- The UNSW setup GUI needs the complete `moodlemobile://` callback link, not the browser's HTTPS address, an RSS key, a password, or an MFA code.
- If a task says a Moodle tool “is not a function”, use the bundled `scripts/read-tool.mjs` recovery path once; repeated calls cannot repair a stale binding.
- Moodle single sign-on cookies are not API tokens. If user tokens are disabled, a Moodle administrator must issue a restricted service token.
- A listed file URL or attachment is metadata, not evidence that file contents were read.
- `list_assignments` covers standard assignment activities; briefs may exist only as course resources.
- Change tracking is on-demand. Its first run establishes a baseline and does not prove that anything was newly added.
- A text-empty PDF may be scanned. This project reads the text layer and does not claim optical character recognition.

Detailed service requirements, safety limits, and recovery commands are in [SETUP.md](plugins/moodle-codex/SETUP.md).

## Development

```powershell
cd .\plugins\moodle-codex
npm ci
npm test
```

Tests use synthetic fixtures, including hostile filenames, cross-origin download attempts, oversized payloads, corrupt snapshots, ZIP traversal, transport recovery, and the exact MCP tool inventory. GitHub Actions runs the same clean install and test sequence.

## Security and privacy

Read [SECURITY.md](SECURITY.md) before reporting a vulnerability. Course downloads and snapshots may contain private academic material; keep `MOODLE_DATA_DIR` outside shared or synced folders.

## License

[MIT](LICENSE)
