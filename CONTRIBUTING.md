# Contributing

Keep the plugin read-only. A change that adds Moodle writes, browser-cookie reuse, authenticated scraping, silent permission bypasses, or execution of downloaded source is outside this project's scope.

Before opening a pull request:

```powershell
cd .\plugins\moodle-codex
npm ci
npm test
```

Add tests for new tool contracts, redaction behavior, size or pagination limits, and failure paths. Live Moodle checks are optional and must not place credentials, course content, or student data in commits, issues, screenshots, or CI logs.
