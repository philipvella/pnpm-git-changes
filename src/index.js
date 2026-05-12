#!/usr/bin/env node

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './config.js';
import { fetchCommitFromUrl } from './fetcher.js';
import { getCommitsWithFiles, getCommitTimestamp } from './git.js';
import { filterRelevantCommits } from './pnpm.js';
import { extractJiraTickets, fetchJiraDetails } from './jira.js';
import { generateWhatChangedBullets } from './openai-helper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = path.join(__dirname, '..', 'output');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'changelog.md');

async function buildWhatChangedList(relevantCommits, tickets, ticketDetails, config) {
  const cleanTicketTitle = (ticket) => {
    const raw = ticketDetails[ticket]?.summary;
    if (!raw || raw === '(Could not fetch)') return ticket;
    return raw
      .replace(/^\[[^\]]+\]\s*/g, '')
      .replace(/\s*-\s*[A-Z]{2,10}-\d+$/g, '')
      .replace(/`/g, '')
      .trim();
  };

  const cleanCommitMessage = (message) => message
    .replace(/^Merged PR\s*\d+:\s*/i, '')
    .replace(/^[A-Z]{2,10}-\d+[:\s-]+/i, '')
    .replace(/^(feat|fix|chore|refactor|docs|test|perf)\([^)]*\):\s*/i, '')
    .replace(/^(feat|fix|chore|refactor|docs|test|perf)\s*[:/-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  // ── Try AI-generated bullets ──────────────────────────────────────────────
  const [aiFirst, aiSecond] = await generateWhatChangedBullets(
    relevantCommits, tickets, ticketDetails, config
  );

  // ── Static fallbacks ──────────────────────────────────────────────────────
  const topTicketTitles = tickets.map(cleanTicketTitle).filter(Boolean).slice(0, 3);
  const cleanedMessages = relevantCommits.map((c) => cleanCommitMessage(c.message)).filter(Boolean);
  const topChanges = [...new Set(cleanedMessages)].slice(0, 3);

  const firstSentence = aiFirst ?? (
    topTicketTitles.length > 0
      ? `The main areas updated are ${topTicketTitles.join(', ')}.`
      : 'These updates are identified directly from commit history and ticket references in the branch.'
  );

  const secondSentence = aiSecond ?? (
    topChanges.length > 0
      ? `Notable implementation changes include ${topChanges.join('; ')}.`
      : 'Detailed commit-level descriptions were limited for this comparison.'
  );

  return [
    `- ${firstSentence}`,
    `- ${secondSentence}`,
  ];
}

function statusBadge(status) {
  if (!status) return '';
  const map = {
    'Done': '✅',
    'Closed': '✅',
    'In Progress': '🔄',
    'In Review': '👀',
    'To Do': '📋',
    'Open': '📋',
    'Blocked': '🚫',
  };
  const icon = map[status] || '🎫';
  return ` ${icon} \`${status}\``;
}

function buildTicketContributorsMap(relevantCommits) {
  const JIRA_TICKET_RE = /\b([A-Z]{2,10}-\d+)\b/g;
  const map = {};
  for (const commit of relevantCommits) {
    const author = (commit.author || '').trim();
    if (!author) continue;
    const matches = commit.message.match(JIRA_TICKET_RE);
    if (matches) {
      for (const ticket of matches) {
        if (!map[ticket]) map[ticket] = new Set();
        map[ticket].add(author);
      }
    }
  }
  return map;
}

function pluralize(value, unit) {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

function formatCommitAgeDifference(uatTimestamp, prodTimestamp) {
  const diffSeconds = Math.abs(prodTimestamp - uatTimestamp);
  const day = 24 * 60 * 60;
  const hour = 60 * 60;
  const minute = 60;

  if (diffSeconds === 0) {
    return 'UAT and Production commits were created at the same time.';
  }

  let display;
  if (diffSeconds >= day) {
    display = pluralize(Math.floor(diffSeconds / day), 'day');
  } else if (diffSeconds >= hour) {
    display = pluralize(Math.floor(diffSeconds / hour), 'hour');
  } else {
    display = pluralize(Math.max(1, Math.floor(diffSeconds / minute)), 'minute');
  }

  const olderEnv = uatTimestamp < prodTimestamp ? 'UAT' : 'Production';
  const newerEnv = olderEnv === 'UAT' ? 'Production' : 'UAT';
  return `${olderEnv} commit is ${display} older than ${newerEnv}.`;
}

async function buildReadmeOutput({ prodCommit, uatCommit, commitAgeDifference, relevantCommits, tickets, ticketDetails, config }) {
  const date = new Date().toISOString().split('T')[0];
  const lines = [];

  lines.push('# Changelog');
  lines.push('');
  lines.push(`> Generated on ${date}`);
  lines.push(`> Comparing UAT (\`${uatCommit.substring(0, 7)}\`) → Production (\`${prodCommit.substring(0, 7)}\`)`);
  if (commitAgeDifference) {
    lines.push(`> Commit age difference: ${commitAgeDifference}`);
  }
  lines.push('');

  // ── What Changed ──────────────────────────────────────────────────────────
  lines.push('## 📝 What Changed');
  lines.push('');

  if (relevantCommits.length === 0) {
    lines.push('_No relevant changes found._');
  } else {
    lines.push(...(await buildWhatChangedList(relevantCommits, tickets, ticketDetails, config)));
  }

  lines.push('');

  // ── Jira Tickets summary table ────────────────────────────────────────────
  lines.push('## 🎫 Jira Tickets');
  lines.push('');

  if (tickets.length === 0) {
    lines.push('_No Jira ticket references found in commit messages._');
  } else {
    const ticketContributors = buildTicketContributorsMap(relevantCommits);
    for (const ticket of tickets) {
      const detail = ticketDetails[ticket];
      const title = detail?.summary && detail.summary !== '(Could not fetch)' ? detail.summary : 'No title available';
      const url = detail?.url || (config.atlassianBaseUrl ? `${config.atlassianBaseUrl.replace(/\/$/, '')}/browse/${ticket}` : '');
      const badge = statusBadge(detail?.status);
      const link = url ? `[${ticket} — ${title}](${url})` : `${ticket} — ${title}`;
      const authors = ticketContributors[ticket] ? ` 👤 ${[...ticketContributors[ticket]].join(', ')}` : '';
      lines.push(`1. ${link}${badge}${authors}`);
    }
  }

  return lines.join('\n');
}

async function main() {
  console.log(chalk.bold.blue('\n🔍  pnpm-git-changes\n'));

  // ── 1. Load or collect configuration ─────────────────────────────────────
  const config = await loadConfig();

  // ── 2. Fetch git commit hashes from environment meta tags ─────────────────
  console.log(chalk.cyan('\nResolving commits...'));

  let prodCommit, uatCommit;

  if (config.commitSource === 'manual') {
    prodCommit = (config.prodCommit || '').trim();
    uatCommit = (config.uatCommit || '').trim();
    if (!prodCommit || !uatCommit) {
      console.error(chalk.red('  ✗ Manual mode requires both production and UAT commit hashes.'));
      process.exit(1);
    }
    console.log(chalk.green(`  ✓ Production : ${prodCommit} (manual)`));
    console.log(chalk.green(`  ✓ UAT        : ${uatCommit} (manual)`));
  } else {
    try {
      prodCommit = await fetchCommitFromUrl(config.prodUrl);
      console.log(chalk.green(`  ✓ Production : ${prodCommit}`));
    } catch (err) {
      console.error(chalk.red(`  ✗ Failed to fetch production commit: ${err.message}`));
      process.exit(1);
    }

    try {
      uatCommit = await fetchCommitFromUrl(config.uatUrl);
      console.log(chalk.green(`  ✓ UAT        : ${uatCommit}`));
    } catch (err) {
      console.error(chalk.red(`  ✗ Failed to fetch UAT commit: ${err.message}`));
      process.exit(1);
    }
  }

  if (prodCommit === uatCommit) {
    console.log(
      chalk.yellow('\n⚠️  Both environments are on the same commit — no changes to report.\n')
    );
    process.exit(0);
  }

  let commitAgeDifference = '';
  try {
    const uatTimestamp = getCommitTimestamp(config.repoPath, uatCommit);
    const prodTimestamp = getCommitTimestamp(config.repoPath, prodCommit);
    commitAgeDifference = formatCommitAgeDifference(uatTimestamp, prodTimestamp);
  } catch (err) {
    console.warn(chalk.yellow(`  ⚠️  Could not compute commit age difference: ${err.message}`));
  }

  // ── 3. Get commits between environments ───────────────────────────────────
  console.log(chalk.cyan('\nAnalysing git history...'));

  let commits;
  try {
    commits = await getCommitsWithFiles(config.repoPath, prodCommit, uatCommit);
    if (commits.length === 0) {
      // Production may be ahead of UAT — try the other direction
      console.log(
        chalk.yellow('  ⚠️  No commits found in that direction, trying reverse...')
      );
      commits = await getCommitsWithFiles(config.repoPath, uatCommit, prodCommit);
    }
    console.log(chalk.green(`  ✓ Found ${commits.length} commit(s) between environments`));
  } catch (err) {
    console.error(chalk.red(`  ✗ Failed to read git history: ${err.message}`));
    process.exit(1);
  }

  if (commits.length === 0) {
    console.log(chalk.yellow('\nNo changes found between the two environments.\n'));
    process.exit(0);
  }

  // ── 4. Filter to commits relevant to the application ──────────────────────
  console.log(chalk.cyan('\nFiltering relevant changes via pnpm workspace analysis...'));

  let relevantCommits;
  try {
    relevantCommits = await filterRelevantCommits(commits, config.repoPath, config.appPath);
    console.log(
      chalk.green(
        `  ✓ ${relevantCommits.length} relevant commit(s) (${commits.length - relevantCommits.length} filtered out)`
      )
    );
  } catch (err) {
    console.warn(chalk.yellow(`  ⚠️  pnpm workspace filter failed — using all commits: ${err.message}`));
    relevantCommits = commits;
  }

  if (relevantCommits.length === 0) {
    console.log(chalk.yellow('\nNo changes found between the two environments.\n'));
    process.exit(0);
  }

  // ── 5. Extract JIRA tickets ────────────────────────────────────────────────
  const tickets = extractJiraTickets(relevantCommits);

  // ── 6. Fetch JIRA details if credentials are available ────────────────────
  let ticketDetails = {};
  if (config.atlassianEmail && config.atlassianApiToken && config.atlassianBaseUrl) {
    console.log(chalk.cyan('\nFetching JIRA ticket details...'));
    try {
      ticketDetails = await fetchJiraDetails(tickets, config);
      const ok = Object.values(ticketDetails).filter((d) => d.status !== 'Error' && d.status !== 'Not Found').length;
      console.log(chalk.green(`  ✓ Fetched ${ok}/${tickets.length} ticket(s)`));
    } catch (err) {
      console.warn(chalk.yellow(`  ⚠️  Failed to fetch JIRA details: ${err.message}`));
    }
  }

  // ── 7. Print results ───────────────────────────────────────────────────────
  const output = await buildReadmeOutput({
    prodCommit,
    uatCommit,
    commitAgeDifference,
    relevantCommits,
    tickets,
    ticketDetails,
    config,
  });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, `${output}\n`, 'utf-8');

  console.log(chalk.green(`\n  ✓ Saved changelog to ${OUTPUT_FILE}`));
  console.log(chalk.bold.green('\n📄  README Output:\n'));
  console.log(output);

  console.log('\n');
}

main().catch((err) => {
  console.error(chalk.red('\nFatal error:'), err.message);
  process.exit(1);
});

