# pnpm-git-changes

`pnpm-git-changes` compares deployed commits between UAT and Production, filters to app-relevant changes in a pnpm workspace, extracts Jira tickets from commit messages, and generates a markdown changelog.

## What it does

1. Resolves two commit hashes (Production and UAT) entered manually.
2. Reads git history between those commits (and tries reverse direction if needed).
3. Filters commits to your app scope:
   - Excludes lock-file-only commits (`*.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`).
   - By default, in pnpm workspaces, keeps only files in the target app and (when detectable) only changed dependency files/components reachable from the app import graph.
   - Optional toggle: include all repo changes (still excluding lock-file-only commits).
4. Extracts Jira IDs from commit messages using `\b[A-Z]{2,10}-\d+\b`.
5. Optionally fetches Jira `summary` and `status` from Jira Cloud API.
6. Writes changelog markdown to `output/changelog.md` and also prints it to stdout.

## Requirements

- Node.js (ESM-compatible runtime)
- Local clone of the target git repository
- 
- Optional Jira Cloud credentials for enriched ticket details
- Optional `OPENAI_API_KEY` for AI-generated "What Changed" bullets

## Install

```bash
cd /Users/philipvella/work/scripts/git/pnpm-git-changes
npm install
```

Or run the helper setup script:

```bash
cd /Users/philipvella/work/scripts/git/pnpm-git-changes
./setup.sh
```

## Run

```bash
cd /Users/philipvella/work/scripts/git/pnpm-git-changes
node src/index.js
```

Alternative run modes:

```bash
cd /Users/philipvella/work/scripts/git/pnpm-git-changes
npm start
npm link
pnpm-git-changes
```

## Configuration behavior

On first run, the tool prompts for required config and writes `.env` in this folder.

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
- `INCLUDE_ALL_CHANGES` (`true` or `false`)

## Jira integration

- With Jira credentials, each ticket includes title and status from Jira REST API.
- Ticket title is a clickable markdown link when Jira base URL is configured.
- Status is shown in backticks below the ticket title.
- Contributors are extracted from commit authors and shown inline next to each status.
- If Jira lookup fails for a ticket, the ticket still appears and the tool continues.

Example ticket output:

```markdown
1. [PROJ-123 – Ticket title](https://your-domain.atlassian.net/browse/PROJ-123)
   `Done` 👤 Jane Smith
```

## Output shape

The tool writes to `output/changelog.md` (gitignored) and prints to stdout:

```markdown
# 📦 CHANGES AVAILABLE FOR TESTING ON UAT FOR MY-APP


🟢 Production commit is `3 days` older than UAT.
Compared: Production | `a1b2c3d` with UAT | `e4f5g6h`

The main areas updated are :
1. Ticket title one,
2. Ticket title two,
3. Ticket title three,

🎫 Jira Tickets:

1. [PROJ-123 – Ticket title](https://your-domain.atlassian.net/browse/PROJ-123)
   `Done` 👤 Jane Smith
2. [PROJ-124 – Another title](https://your-domain.atlassian.net/browse/PROJ-124)
   `In Progress` 👤 John Doe
```

## Notes

- If both environments resolve to the same commit, the tool exits with no changes.
- If no commits are found in one direction, it automatically retries the reverse direction.
- If no relevant commits remain after filtering, the tool exits with no changes.
- Output includes a concise one-line commit comparison: `Production | shortHash` with `UAT | shortHash`.
- The first `📝 Change log:` item includes an age indicator emoji based on commit age difference:
  - `🟢` (< 7 days)
  - `🟠` (>= 7 and < 14 days)
  - `🔴` (>= 14 days)
- The commit age duration is shown in backticks, e.g. `` `13 days` ``.
- Jira enrichment is optional; core comparison and ticket extraction still work without it.
