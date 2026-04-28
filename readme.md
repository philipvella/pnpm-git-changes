# pnpm-git-changes

`pnpm-git-changes` compares deployed commits between UAT and Production, filters to app-relevant changes in a pnpm workspace, extracts Jira tickets from commit messages, and prints a markdown changelog.

## What it does

1. Resolves two commit hashes (UAT and Production):
   - `url` mode: fetches each page and reads commit from one of:
     - `<meta name="git-commit" content="...">`
     - `<meta property="git-commit" content="...">`
     - `data-git-commit` on `<body>` or `<html>`
   - `manual` mode: uses commit hashes you enter.
2. Reads git history between those commits (and tries reverse direction if needed).
3. Filters commits to your app scope:
   - Excludes lock-file-only commits (`*.lock`, `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`).
   - In pnpm workspaces, keeps only files in the target app and its workspace dependency graph.
4. Extracts Jira IDs from commit messages using `\b[A-Z]{2,10}-\d+\b`.
5. Optionally fetches Jira `summary` and `status` from Jira Cloud API.
6. Optionally uses OpenAI to generate two concise "What Changed" bullets.
7. Prints changelog markdown to stdout.

## Requirements

- Node.js (ESM-compatible runtime)
- Local clone of the target git repository
- UAT and Production pages exposing a git commit marker (only for `url` mode)
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

1. Commit source mode (`url` or `manual`)
2. If `url`: Production URL + UAT URL
3. If `manual`: Production commit hash + UAT commit hash
4. Local repo path (absolute)
5. App path inside repo (for example `apps/my-app`)
6. Branch name (saved, currently informational)
7. Whether to configure Jira credentials
8. If Jira enabled: Jira base URL, Atlassian email, Atlassian API token
9. Whether to configure OpenAI API key
10. If OpenAI enabled: OpenAI API key

Environment variables supported:

- `COMMIT_SOURCE` (`url` or `manual`)
- `PROD_URL`
- `UAT_URL`
- `PROD_COMMIT`
- `UAT_COMMIT`
- `REPO_PATH`
- `APP_PATH`
- `BRANCH`
- `ATLASSIAN_BASE_URL`
- `ATLASSIAN_EMAIL`
- `ATLASSIAN_API_TOKEN`
- `OPENAI_API_KEY`

## Jira integration

- With Jira credentials, each ticket includes title and status from Jira REST API.
- Ticket output is markdown and clickable when Jira base URL is configured.
- Contributors are extracted from commit authors and shown inline next to each ticket.
- If Jira lookup fails for a ticket, the ticket still appears and the tool continues.

Example ticket line:

```markdown
1. [PROJ-123 - Ticket title](https://your-domain.atlassian.net/browse/PROJ-123) ✅ `Done` 👤 Jane Smith
```

## Output shape

The tool prints markdown to stdout (it does not write files automatically):

```markdown
# Changelog

> Generated on YYYY-MM-DD
> Comparing UAT (`abcdef1`) -> Production (`1234567`)

## 📝 What Changed
- The main areas updated are ...
- Notable implementation changes include ...

## 🎫 Jira Tickets
1. [PROJ-123 - Title](https://your-domain.atlassian.net/browse/PROJ-123) ✅ `Done` 👤 Jane Smith
1. [PROJ-124 - Another Title](https://your-domain.atlassian.net/browse/PROJ-124) 🔄 `In Progress` 👤 John Doe, Jane Smith
```

## Notes

- If both environments resolve to the same commit, the tool exits with no changes.
- If no commits are found in one direction, it automatically retries the reverse direction.
- If no relevant commits remain after filtering, the tool exits with no changes.
- Jira/OpenAI enrichment is optional; core comparison and ticket extraction still work without them.
