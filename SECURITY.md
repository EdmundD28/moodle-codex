# Security policy

## Supported version

Security fixes target the current `main` branch until tagged releases are introduced.

## Reporting

Do not open a public issue containing a Moodle token, private course material, student information, or a working exploit. Use GitHub's private vulnerability reporting for this repository. If that feature is unavailable, contact the repository owner privately and share only the minimum evidence needed to reproduce the issue.

## Security boundaries

- The Moodle MCP surface is fixed and read-only. There are no submission, messaging, enrolment, grading, or activity-view mutation tools.
- Credentials come from process environment variables and must never be committed to the repository.
- Moodle content is untrusted input. Source files are returned as text and are never executed.
- Downloads are limited to fresh same-origin HTTPS Moodle file URLs and saved under content-addressed `.bin` names.
- PDF and ZIP parsing runs in a bounded worker. Limits reduce risk but do not make third-party parsers infallible.
- Local snapshots and downloads may contain private academic data. Protect `MOODLE_DATA_DIR` accordingly.

## If a token is exposed

Revoke it in Moodle immediately, remove the current-user `MOODLE_TOKEN` environment variable, restart affected processes, and inspect repository history and logs before issuing a replacement.
