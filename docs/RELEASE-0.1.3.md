# 0.1.3 security update and validation

Validated on 12 October 2026 (Australia/Sydney), using Windows and Node.js 24.19.0.

## Changes

- Pin `@modelcontextprotocol/sdk` to 1.31.0 in both the package manifest and lockfile. This patches [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h). The advisory excludes MCP servers and stdio clients, but shipping the patched dependency also removes the obsolete vulnerable dependency from new installations.
- Explicitly declare all four permission hints for the extended tools. The four local writers remain marked as writes. Moodle operations remain read-only.
- Verify the permission hints and object input schemas of all 20 tools through a real MCP stdio connection. Invalid course IDs, arbitrary file URLs and unsupported progress actions are rejected before Moodle access.
- Reject high or critical known production dependency vulnerabilities in CI.
- Return a failing exit status when any attempted live verification probe fails.
- Bump both package and plugin versions to 0.1.3 so the updated build can be identified during connection checks.

## Evidence

| Check | Result |
| --- | --- |
| Clean install from the lockfile through `scripts/bootstrap.ps1` | Passed |
| Offline tests after the clean install | 36 passed, 0 failed |
| Windows PowerShell setup self-test | Passed; no network or settings writes |
| `npm audit --omit=dev --audit-level=high` | 0 known vulnerabilities |
| MCP tool inventory, all four permission hints and input schemas | All 20 tools verified |
| Authenticated Moodle connection using the revised source | Connected; build 0.1.3 |
| Course listing, contents, assignment listing, deadline radar, study plan, PDF text, download, ZIP inventory/source, forum listing, feedback and change snapshots | Read successfully for the tested account and course |
| Local dashboard generation | Passed in an isolated, ignored test directory |
| Optional grading definitions API | Moodle returned `core_grading_get_definitions failed (accessexception): Access control exception` |

The same live checks were repeated against an isolated export of commit `48ede83`, with its original SDK 1.30.0. The old and revised builds returned matching file counts, deadline counts, plan item counts, PDF text length, ZIP results and download SHA-256. The original build received the same grading-definitions access denial. This is an existing account/site permission limitation, not a regression introduced by this update. The revised verifier correctly returns failure for that attempted probe instead of silently exiting successfully.

The forum was accessible but exposed no discussions, so successful post-body retrieval was not established. Local completion/mood changes were not performed against the user's actual study state. The offline tests cover these paths. These smoke checks do not prove compatibility with every Moodle deployment or access to hidden material.

No Moodle writes were performed. Tokens, private course files and live test output are excluded from this release evidence and remain outside the committed files.

## Updating and external scores

Install the updated plugin and run `npm ci` in its plugin directory if managing dependencies manually. Start a fresh chat after updating; an already-running process can retain older code. `check_connection` should report build `0.1.3`.

M8ven scores refer to the commit last scanned. The dependency finding should be reassessed against the updated lockfile, and the MCP contract test provides runtime evidence for the declarations missed by static analysis. A new published score requires an external rescan; this document does not claim a higher grade or third-party certification.
