# Demo runbook

This runbook separates deterministic proof from account-dependent proof. Do not turn “the script ran” into a claim that every Moodle capability is available to every account.

## 1. Offline proof

From the repository root:

```powershell
pwsh -File .\scripts\bootstrap.ps1
```

Expected result: dependency installation completes, all tests pass, and the script prints `PASS`. This proves the repository can be installed from its lockfile and that the synthetic safety and transport tests pass. It makes no Moodle request.

## 2. Installation proof

```powershell
codex plugin marketplace add .
```

Restart the desktop app, install the plugin from the **Moodle for Codex** marketplace, open a new task, and ask:

```text
检查 Moodle 连接，并告诉我 connected、build 和 feature_set。
```

Expected result: `connected: true`, manifest build `0.1.0`, and `feature_set: stages-1-4`. A saved token without this response is not installation proof.

## 3. User-facing flow

Use a course visible to the demonstrator's account:

1. “列出我当前可见的 Moodle 课程。”
2. “找出最近 30 天的截止日期，并注明来源课程。”
3. “列出这门课的文件；读取其中一个 PDF 的第一页。”
4. “检查这门课的更新。” Run this twice to show that the first call establishes a baseline and the second compares against it.

If the course exposes forums, feedback, or an active rubric, demonstrate those tools. If it does not, say that the Moodle permission or course structure does not expose them; do not substitute fabricated output.

## 4. Live transport verifier

```powershell
cd .\plugins\moodle-codex
$env:MOODLE_VERIFY_COURSE = 'course name pattern'
npm run verify:live
```

The verifier uses an isolated local data directory unless `MOODLE_DATA_DIR` is set. It prints bounded JSON lines and returns a non-zero exit code only for fatal setup failures. Individual unavailable optional capabilities are reported as failed probes so the rest of the read-only flow can still be inspected.

## Reset

- Revoke the token in Moodle if it was exposed.
- Remove the current-user `MOODLE_TOKEN` and `MOODLE_BASE_URL` environment variables when decommissioning the demo.
- Delete the chosen `MOODLE_DATA_DIR` only after confirming it contains no material you need to retain.
