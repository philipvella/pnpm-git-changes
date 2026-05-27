#!/usr/bin/env node

import chalk from 'chalk';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from './config.js';
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

  // ── Static fallbacks ──────────────────────────────────────────────────────
  const topTicketTitles = tickets.map(cleanTicketTitle).filter(Boolean).slice(0, 3);

  // Always use structured format with "The main areas updated are :"
  const lines = [];
  if (topTicketTitles.length > 0) {
    lines.push('The main areas updated are :');
    topTicketTitles.forEach((title) => {
      lines.push(`${title},`);
    });
  } else {
    lines.push('These updates are identified directly from commit history and ticket references in the branch.');
  }

  return lines;
}

function statusBadge(status) {
  if (!status) return '';
  return `\`${status}\``;
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

function getAppDisplayName(config) {
  const fallback = (config.appPath || '').split('/').filter(Boolean).pop() || 'APP_NAME';
  const appPkgPath = path.join(config.repoPath || '', config.appPath || '', 'package.json');

  if (config.repoPath && config.appPath && fs.existsSync(appPkgPath)) {
    try {
      const appPkg = JSON.parse(fs.readFileSync(appPkgPath, 'utf-8'));
      if (appPkg?.name) return appPkg.name;
    } catch (_) {
      // ignore malformed package.json and use fallback
    }
  }

  return fallback;
}

function pluralize(value, unit) {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

function getAgeSeverityEmoji(diffSeconds) {
  const week = 7 * 24 * 60 * 60;
  const twoWeeks = 14 * 24 * 60 * 60;
  if (diffSeconds < week) return '🟢';
  if (diffSeconds < twoWeeks) return '🟠';
  return '🔴';
}

function getCommitAgeInfo(uatTimestamp, prodTimestamp) {
  const diffSeconds = Math.abs(prodTimestamp - uatTimestamp);
  const day = 24 * 60 * 60;
  const hour = 60 * 60;
  const minute = 60;

  if (diffSeconds === 0) {
    return {
      diffSeconds,
      description: 'UAT and Production commits were created at the same time.',
    };
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
  return {
    diffSeconds,
    description: `${olderEnv} commit is \`${display}\` older than ${newerEnv}.`,
  };
}

async function buildReadmeOutput({ prodCommit, uatCommit, commitAgeDifference, commitAgeDiffSeconds, relevantCommits, tickets, ticketDetails, config }) {
  const date = new Date().toISOString().split('T')[0];
  const lines = [];
  const appName = getAppDisplayName(config);
  const appNameUpper = appName.toUpperCase();

  lines.push(`# 📦 CHANGES AVAILABLE FOR TESTING ON UAT FOR ${appNameUpper}`);
  lines.push('');

  // ── What Changed ──────────────────────────────────────────────────────────
  lines.push('');

  const ageEmoji = typeof commitAgeDiffSeconds === 'number' ? getAgeSeverityEmoji(commitAgeDiffSeconds) : '';
  let itemNum = 1;

  if (relevantCommits.length === 0) {
    lines.push('_No relevant changes found._');
  } else {
    if (commitAgeDifference) {
      lines.push(`${ageEmoji} ${commitAgeDifference}`);
    }

    lines.push(`Compared: Production | \`${prodCommit.slice(0, 7)}\` with UAT | \`${uatCommit.slice(0, 7)}\``);
    lines.push('');

    const whatChangedLines = await buildWhatChangedList(relevantCommits, tickets, ticketDetails, config);
    if (whatChangedLines.length > 0) {
      lines.push(whatChangedLines[0]);
      itemNum = 1;
      for (const line of whatChangedLines.slice(1)) {
        if (!line.trim()) continue;
        lines.push(`${itemNum}. ${line}`);
        itemNum++;
      }
    }
  }

  lines.push('');

  // ── Jira Tickets summary table ────────────────────────────────────────────
  lines.push('🎫 Jira Tickets:');
  lines.push('');

  if (tickets.length === 0) {
    lines.push('_No Jira ticket references found in commit messages._');
  } else {
    const ticketContributors = buildTicketContributorsMap(relevantCommits);
    let ticketNum = 1;
    for (const ticket of tickets) {
      const detail = ticketDetails[ticket];
      const title = detail?.summary && detail.summary !== '(Could not fetch)' ? detail.summary : 'No title available';
      const url = detail?.url || (config.atlassianBaseUrl ? `${config.atlassianBaseUrl.replace(/\/$/, '')}/browse/${ticket}` : '');
      const status = statusBadge(detail?.status);
      const link = url ? `[${ticket} – ${title}](${url})` : `${ticket} – ${title}`;
      const authors = ticketContributors[ticket] ? ` 👤 ${[...ticketContributors[ticket]].join(', ')}` : '';

      lines.push(`${ticketNum}. ${link}`);
      lines.push(`   ${status}${authors}`);
      ticketNum++;
    }
  }

  return lines.join('\n');
}

async function main() {
  console.log(chalk.bold.blue('\n🔍  pnpm-git-changes\n'));

  // ── 1. Load or collect configuration ─────────────────────────────────────
  const config = await loadConfig();

  // ── 2. Resolve commit hashes ──────────────────────────────────────────────
  console.log(chalk.cyan('\nResolving commits...'));

  const prodCommit = (config.prodCommit || '').trim();
  const uatCommit = (config.uatCommit || '').trim();

  if (!prodCommit || !uatCommit) {
    console.error(chalk.red('  ✗ Both production and UAT commit hashes are required.'));
    process.exit(1);
  }

  console.log(chalk.green(`  ✓ Production : ${prodCommit}`));
  console.log(chalk.green(`  ✓ UAT        : ${uatCommit}`));

  if (prodCommit === uatCommit) {
    console.log(
      chalk.yellow('\n⚠️  Both environments are on the same commit — no changes to report.\n')
    );
    process.exit(0);
  }

  let commitAgeDifference = '';
  let commitAgeDiffSeconds;
  try {
    const uatTimestamp = getCommitTimestamp(config.repoPath, uatCommit);
    const prodTimestamp = getCommitTimestamp(config.repoPath, prodCommit);
    const commitAgeInfo = getCommitAgeInfo(uatTimestamp, prodTimestamp);
    commitAgeDifference = commitAgeInfo.description;
    commitAgeDiffSeconds = commitAgeInfo.diffSeconds;
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
  console.log(chalk.cyan('\nFiltering relevant changes via pnpm workspace + app usage analysis...'));

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
    commitAgeDiffSeconds,
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

