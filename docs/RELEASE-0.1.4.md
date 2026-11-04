# 0.1.4 security maintenance and compatibility validation

Validated on 4 November 2026 (Australia/Sydney), on Windows with Node.js 22.13.0 and 24.19.0, using npm 11.17.0 for installation.

## Scope

- Update `@modelcontextprotocol/sdk` from 1.31.0 to 1.32.2 and `zod` from 4.6.5 to 4.6.7, pinned exactly in the manifest and lockfile.
- Refresh vulnerable transitive dependencies within their existing declared ranges: `@hono/node-server`, `body-parser`, `fast-uri`, `hono`, `ip-address`, and `qs`.
- Keep `pdfjs-dist` at 6.3.289 and `yauzl` at 3.4.0. No application handlers, tool definitions, setup scripts, or Moodle permissions changed.
- Set both the package and plugin versions to 0.1.4.
- Expand GitHub Actions to run the suite on Windows and Linux with Node.js 22.13.0 and 24. The matrix has been prepared locally; its hosted results are still pending a branch push.

The SDK update addresses advisories including [task session isolation](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-22jm-h49p-29qw) and [HTTP validation memory exhaustion](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453). Those advisories require features this stdio-only server does not expose; removing affected dependency versions still avoids shipping the obsolete packages. This release does not add an HTTP transport or experimental task storage.

## Validation evidence

| Check | Result |
| --- | --- |
| Original 0.1.3 offline suite before changes | 36 passed, 0 failed |
| Clean install of the updated lockfile | Passed |
| Updated 0.1.4 offline suite | 36 passed, 0 failed |
| Clean candidate via the documented `scripts/bootstrap.ps1` installation flow | Passed: clean install, all 36 tests, and setup self-test |
| Minimum supported Node.js 22.13.0, clean candidate | 36 passed, 0 failed |
| Production dependency audit | 0 known vulnerabilities at validation time |
| Exact Windows double-click launcher, `Setup-Moodle.cmd -SelfTest` | Passed; no network or settings writes |
| Runtime comparison against an isolated 0.1.3 copy with its original lockfile | All 20 tool names, descriptions, annotations and input schemas identical |
| Invalid input comparison through MCP | Both versions reject invalid course IDs, assignment course-ID elements, forum page limits, file IDs and progress actions before Moodle access |
| Live authenticated Moodle connection | Connected; new build reports 0.1.4 |
| Live verifier comparison | Same results after excluding build version and isolated dashboard paths |
| Actual installed 0.1.2 build versus clean 0.1.4 candidate | All 20 tool declarations, five invalid-input cases and live verifier output match, excluding build and isolated paths |

The original default temporary directory rejected file-renaming operations in five offline tests. Setting process-local `TEMP` and `TMP` to the ignored `.npm-cache/test-tmp` directory resolved this for both the original and updated release; no application code was changed to hide or bypass those failures.

The live comparison covered course listing, course contents and file metadata, assignment listing, deadline radar, weekly plan, local dashboard generation, forum listing, grading feedback, and two consecutive course-change snapshots. Downloads, dashboards and snapshots use isolated ignored directories, not the user's normal local study state. No Moodle writes were performed.

## Explicit limits

- The grading-definition probe failed with `accessexception` in both versions. Both complete live verifier runs therefore returned a failing exit status; they are not represented as fully successful runs. The comparison confirmed the same pre-existing account/site restriction.
- The selected course exposed no forums and did not exercise the live verifier's PDF, download or ZIP probes. Real post-body retrieval and live file parsing were not established in this validation. Offline fixtures cover PDF text, ZIP inventory/source reads, file-download limits, path traversal, account isolation, snapshots, dashboard escaping and local study-state writes.
- No new local progress or mood records were written against the user's real study state.
- Compatibility was tested on Windows and Node.js 22.13.0 and 24.19.0. Linux checks have not run locally because the container engine is unavailable; the hosted CI matrix must pass before promotion. These results do not establish every supported Node.js version, operating system, Moodle site or permission combination.
- Private live outputs, credentials, original vulnerable baseline dependencies and downloaded files remain ignored local validation artifacts and are not release files. The original baseline must not be distributed as the updated plugin.

## Updating

Install the updated plugin. For a manually managed clone, run `npm ci` inside `plugins/moodle-codex`, restart the server/client as appropriate, and open a fresh chat. Confirm that `check_connection` returns `connected: true` and build `0.1.4`.

For offline verification, run `npm test` and `Setup-Moodle.cmd -SelfTest` in the plugin directory. Where the default temporary directory is restricted, create `.npm-cache/test-tmp` and set `TEMP` and `TMP` to its absolute path for that process before running the tests.

This document records local validation. Publishing, updating an installed plugin cache and a new M8ven scan are separate actions; it does not claim a changed external score or guarantee absence of every possible defect.

## Release and rollback gates

1. Publish only the security-update changes and their documentation on a `codex/` review branch. Exclude unrelated pending star-invitation edits, the untracked logo experiment, generated dependencies, local backups and all live data. In a mixed README diff, include only the release-version paragraph.
2. Recheck the remote base before pushing; use a regular non-forced branch push. Wait for the four Windows/Linux and Node.js matrix jobs, plus the Windows setup job, to pass. Do not promote a failing candidate or describe pending jobs as passed.
3. Before changing a personal plugin, resolve its actual marketplace root and source path. This validation found that the running personal plugin was still 0.1.2, separately installed from the development repository. A GitHub push alone does not update that local copy.
4. Retain byte-verified backups of both the personal source and installed cache, including their original dependencies. The backups and SHA-256 inventories are local ignored artifacts, not published release files. Keep Moodle credentials and the normal local study-data directory unchanged.
5. Update the registered marketplace source from the tested candidate, then refresh/reinstall through the supported plugin flow and fully restart the desktop client. Do not overwrite a running cache and assume its server has changed. Local source resolution, cache loading and restart behavior are documented in [OpenAI's plugin packaging guide](https://developers.openai.com/plugins/build/plugins).
6. In a new chat, require `check_connection` to return build 0.1.4 and a successful connection, list courses, and confirm one normal deadline/study-plan task. If the build stays old, stop and diagnose the source/cache mapping; repeated restarts do not prove an update.
7. If acceptance fails, close the client, restore the exact backed-up personal source, refresh/reinstall it and restart. Preserve the old cache and its inventory until the restored build and normal course read are verified. Do not delete or restore over the user's separate Moodle study-data directory. The old dependency versions are a temporary fallback only, not a new security-approved release.

No remote push, merge, marketplace source replacement or installed-cache replacement was performed during this preflight. Hosted CI and a post-install fresh-chat acceptance check remain separate gates.
