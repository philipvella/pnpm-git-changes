# pnpm-git-changes

`pnpm-git-changes` compares deployed commits between UAT and Production, filters to app-relevant changes in a pnpm workspace, extracts Jira tickets from commit messages, and generates a markdown changelog.

## What it does

1. **Compares deployments**
   - Compares the configured Production and UAT commits.
   - Fetches git history first and retries in the opposite direction if no commits are found.
2. **Filters app-relevant changes**
   - Excludes commits that only change lock files: `*.lock`, `pnpm-lock.yaml`, `yarn.lock`, or `package-lock.json`.
   - In a pnpm workspace, focuses on the configured app and workspace source files reachable through its imports.
   - If import analysis is unavailable, falls back to app and workspace dependency paths. Outside a pnpm workspace, includes commits with non-lock-file changes.
3. **Jira tickets Interactions**
  - Extracts unique Jira IDs from relevant commit messages using `\b[A-Z][A-Z0-9]{1,9}-\d+\b`.
   - Optionally fetches each ticket’s summary and status.
   - Can post a release comment to each ticket when Jira comments and a release build URL are configured; tickets already commented for that build are skipped.
4. **Creates the release changelog**
   - Includes the commit comparison, a risk level based on the commit timestamp gap and Jira ticket count, tickets and their commit authors, relevant commit messages, and authors.
   - Generates the “Main areas updated” summary with OpenAI when configured; otherwise, it falls back to Jira ticket summaries.
5. **Saves and prints the output**
   - Writes the markdown changelog to `output/changelog.md`.
   - Prints the changelog to stdout.

## Requirements

- Node.js (ESM-compatible runtime)
- Local clone of the target git repository
- 
- Optional Jira Cloud credentials for enriched ticket details
- Optional `OPENAI_API_KEY` for AI-generated "What Changed" bullets

## Install

```bash
cd /path/to/your/pnpm-git-changes
npm install
```

Or run the Node-based setup script:

```bash
cd /path/to/your/pnpm-git-changes
npm run setup
```

## Run

```bash
cd /path/to/your/pnpm-git-changes
node src/index.js
```

Alternative run modes:

```bash
cd /path/to/your/pnpm-git-changes
npm start
npm link
pnpm-git-changes
```

## Configuration behavior

On first run, the tool prompts for required config and writes `.env` in this folder.

Alternatively, copy the template and fill it in: `cp .env.example .env`.

On later runs, if saved config exists, it asks:
- `Yes, use saved settings`
- `No, update settings`

Prompted values:

1. Production commit hash
2. UAT commit hash
3. Local repo path (absolute)
4. App path inside repo (for example `apps/my-app`)
5. Branch name (saved, currently informational)
6. Whether to configure Jira credentials
7. If Jira enabled: Jira base URL, Atlassian email, Atlassian API token
8. Whether to configure OpenAI API key
9. If OpenAI enabled: OpenAI API key
10. Toggle to include all repo changes, or focus on app + workspace dependencies used by the app

Environment variables supported:

- `PROD_COMMIT`
- `UAT_COMMIT`
- `REPO_PATH`
- `APP_PATH`
- `BRANCH`
- `ATLASSIAN_BASE_URL`
- `ATLASSIAN_EMAIL`
- `ATLASSIAN_API_TOKEN`
- `OPENAI_API_KEY`
- `RELEASE_BUILD_URL` (optional; makes the changelog title a link to the release build)
- `JIRA_COMMENT_ON_RELEASE` (`true` or `false`, default `false`; posts a release comment on each Jira ticket)
- `INCLUDE_ALL_CHANGES` (`true` or `false`)

## Jira integration

- With Jira credentials, each ticket includes title and status from Jira REST API.
- Ticket title is a clickable markdown link when Jira base URL is configured.
- Status is shown in backticks below the ticket title.
- Contributors are extracted from commit authors and shown inline next to each status.
- If Jira lookup fails for a ticket, the ticket still appears and the tool continues.
- With `JIRA_COMMENT_ON_RELEASE=true` and `RELEASE_BUILD_URL` set, the tool comments on every ticket:
  "This ticket is included in **RELEASE FOR MY-APP**." plus a link to the release build.
  Tickets that already have a comment containing the same build URL are skipped, so re-runs are safe.

Example ticket output:

```markdown
1. [PROJ-123 – Ticket title](https://your-domain.atlassian.net/browse/PROJ-123)
   `Done` Authors: Jane Smith
```

## Output shape

The tool writes to `output/changelog.md` (gitignored) and prints to stdout:

```markdown
# [RELEASE FOR MY-APP](https://dev.azure.com/org/project/_build/results?buildId=123)


ℹ️ Release Details:
- Risk: [LOW-RISK] 🟢
- Production commit is `3 days` older than UAT.
- Compared commits: 
  - `a1b2c3d` | Production
  - `e4f5g6h` | UAT

🧩 Main areas updated:
- Ticket title one
- Ticket title two
- Ticket title three

🎫 Jira Tickets:

1. [PROJ-123 - Ticket title](https://your-domain.atlassian.net/browse/PROJ-123)
   `Done` Authors: Jane Smith
2. [PROJ-124 - Another title](https://your-domain.atlassian.net/browse/PROJ-124)
   `In Progress` Authors: John Doe

🧾 Commit Messages:

```
1. PROJ-123 add profile edit screen
2. PROJ-124 fix save button loading state
```

👥 Authors:

- John Doe

_Source repo: [philipvella/pnpm-git-changes](https://github.com/philipvella/pnpm-git-changes)_
```

## Notes

- If both environments resolve to the same commit, the tool exits with no changes.
- If no commits are found in one direction, it automatically retries the reverse direction.
- If no relevant commits remain after filtering, the tool exits with no changes.
- Output includes a concise one-line commit comparison: `Production | shortHash` with `UAT | shortHash`.
- The first change-log item includes a combined risk label based on commit age gap and Jira ticket count.
- Commit age risk:
  - `🟢 [LOW-RISK]` (< 7 days)
  - `🟠 [MEDIUM-RISK]` (>= 7 and < 14 days)
  - `🔴 [HIGH-RISK]` (>= 14 days)
- Ticket count risk:
  - `🟢 [LOW-RISK]` (< 2 tickets)
  - `🟠 [MEDIUM-RISK]` (>= 2 and < 5 tickets)
  - `🔴 [HIGH-RISK]` (>= 5 tickets)
- Final risk uses the higher of the age-based and ticket-count-based levels.
- The commit age duration is shown in backticks, e.g. `` `13 days` ``.
- Jira enrichment is optional; core comparison and ticket extraction still work without it.
