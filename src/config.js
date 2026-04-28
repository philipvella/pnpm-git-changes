import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as dotenv from 'dotenv';
import inquirer from 'inquirer';
import chalk from 'chalk';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(__dirname, '..', '.env');

function readEnv() {
  if (fs.existsSync(ENV_PATH)) {
    const result = dotenv.config({ path: ENV_PATH });
    return result.parsed || {};
  }
  return {};
}

function saveEnv(values) {
  const lines = Object.entries(values)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${k}=${v}`);
  fs.writeFileSync(ENV_PATH, lines.join('\n') + '\n', 'utf-8');
}

function mergeWithProcess(saved) {
  return {
    commitSource: process.env.COMMIT_SOURCE || saved.COMMIT_SOURCE || 'url',
    prodUrl: process.env.PROD_URL || saved.PROD_URL || '',
    uatUrl: process.env.UAT_URL || saved.UAT_URL || '',
    prodCommit: process.env.PROD_COMMIT || saved.PROD_COMMIT || '',
    uatCommit: process.env.UAT_COMMIT || saved.UAT_COMMIT || '',
    repoPath: process.env.REPO_PATH || saved.REPO_PATH || '',
    appPath: process.env.APP_PATH || saved.APP_PATH || '',
    branch: process.env.BRANCH || saved.BRANCH || 'origin/master',
    atlassianEmail: process.env.ATLASSIAN_EMAIL || saved.ATLASSIAN_EMAIL || '',
    atlassianApiToken: process.env.ATLASSIAN_API_TOKEN || saved.ATLASSIAN_API_TOKEN || '',
    atlassianBaseUrl: process.env.ATLASSIAN_BASE_URL || saved.ATLASSIAN_BASE_URL || '',
    openaiApiKey: process.env.OPENAI_API_KEY || saved.OPENAI_API_KEY || '',
  };
}

export async function loadConfig() {
  const saved = readEnv();
  const current = mergeWithProcess(saved);
  const hasCommitInputs = current.commitSource === 'manual'
    ? current.prodCommit && current.uatCommit
    : current.prodUrl && current.uatUrl;
  const hasSaved = hasCommitInputs && current.repoPath && current.appPath;

  let updateMode = false;

  if (hasSaved) {
    console.log(chalk.gray('\nSaved configuration found:'));
    console.log(chalk.gray(`  Production URL : ${current.prodUrl}`));
    console.log(chalk.gray(`  UAT URL        : ${current.uatUrl}`));
    console.log(chalk.gray(`  Repo path      : ${current.repoPath}`));
    console.log(chalk.gray(`  App path       : ${current.appPath}`));
    console.log(chalk.gray(`  Branch         : ${current.branch}`));
    console.log(chalk.gray(`  Commit source  : ${current.commitSource}`));
    if (current.commitSource === 'manual') {
      console.log(chalk.gray(`  Prod commit    : ${current.prodCommit || '(not set)'}`));
      console.log(chalk.gray(`  UAT commit     : ${current.uatCommit || '(not set)'}`));
    }
    if (current.atlassianBaseUrl) console.log(chalk.gray(`  Jira base URL  : ${current.atlassianBaseUrl}`));

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Use saved configuration?',
        choices: [
          { name: 'Yes, use saved settings', value: 'use' },
          { name: 'No, update settings', value: 'update' },
        ],
      },
    ]);
    if (action === 'update') updateMode = true;
  }

  if (!hasSaved || updateMode) {
    console.log(chalk.cyan('\nPlease provide the required configuration:\n'));

    const { commitSource } = await inquirer.prompt([
      {
        type: 'list',
        name: 'commitSource',
        message: 'How should commits be provided?',
        choices: [
          { name: 'Fetch from environment URLs (meta tag)', value: 'url' },
          { name: 'Enter commit hashes manually', value: 'manual' },
        ],
        default: current.commitSource === 'manual' ? 'manual' : 'url',
      },
    ]);

    const commitQuestions = commitSource === 'manual'
      ? [
          {
            type: 'input',
            name: 'prodCommit',
            message: 'Production commit hash:',
            default: current.prodCommit || undefined,
            validate: (v) => /^[0-9a-fA-F]{7,40}$/.test(v.trim()) ? true : 'Enter a valid 7-40 char git hash',
          },
          {
            type: 'input',
            name: 'uatCommit',
            message: 'UAT commit hash:',
            default: current.uatCommit || undefined,
            validate: (v) => /^[0-9a-fA-F]{7,40}$/.test(v.trim()) ? true : 'Enter a valid 7-40 char git hash',
          },
        ]
      : [
          {
            type: 'input',
            name: 'prodUrl',
            message: 'Production URL (with the git-commit meta tag):',
            default: current.prodUrl || undefined,
            validate: (v) => v.trim() ? true : 'Required',
          },
          {
            type: 'input',
            name: 'uatUrl',
            message: 'UAT URL (with the git-commit meta tag):',
            default: current.uatUrl || undefined,
            validate: (v) => v.trim() ? true : 'Required',
          },
        ];

    const answers = await inquirer.prompt([
      ...commitQuestions,
      {
        type: 'input',
        name: 'repoPath',
        message: 'Local repo path (absolute):',
        default: current.repoPath || undefined,
        validate: (v) => {
          if (!v.trim()) return 'Required';
          if (!fs.existsSync(v.trim())) return `Path does not exist: ${v}`;
          return true;
        },
      },
      {
        type: 'input',
        name: 'appPath',
        message: 'Application path inside the repo (e.g. apps/my-app):',
        default: current.appPath || undefined,
        validate: (v) => v.trim() ? true : 'Required',
      },
      {
        type: 'input',
        name: 'branch',
        message: 'Branch name (used as fallback base):',
        default: current.branch || 'origin/master',
      },
      {
        type: 'confirm',
        name: 'configureJira',
        message: 'Configure Jira credentials?',
        default: !!(current.atlassianEmail || updateMode),
      },
      {
        type: 'confirm',
        name: 'configureOpenAI',
        message: 'Configure OpenAI API key (for AI-generated "What Changed" summary)?',
        default: !!(current.openaiApiKey || updateMode),
      },
    ]);

    let jiraAnswers = {};
    if (answers.configureJira) {
      jiraAnswers = await inquirer.prompt([
        {
          type: 'input',
          name: 'atlassianBaseUrl',
          message: 'Jira base URL (e.g. https://company.atlassian.net):',
          default: current.atlassianBaseUrl || undefined,
          validate: (v) => v.trim() ? true : 'Required',
        },
        {
          type: 'input',
          name: 'atlassianEmail',
          message: 'Atlassian email:',
          default: current.atlassianEmail || undefined,
          validate: (v) => v.trim() ? true : 'Required',
        },
        {
          type: 'password',
          name: 'atlassianApiToken',
          message: 'Atlassian API token:',
          default: current.atlassianApiToken || undefined,
          validate: (v) => v.trim() ? true : 'Required',
        },
      ]);
    }

    let openaiAnswers = {};
    if (answers.configureOpenAI) {
      openaiAnswers = await inquirer.prompt([
        {
          type: 'password',
          name: 'openaiApiKey',
          message: 'OpenAI API key (sk-...):',
          default: current.openaiApiKey || undefined,
          validate: (v) => v.trim() ? true : 'Required',
        },
      ]);
    }

    const merged = {
      commitSource,
      ...answers,
      ...jiraAnswers,
      ...openaiAnswers,
      configureJira: undefined,
      configureOpenAI: undefined,
    };

    // Fill blanks from existing if user skipped sections
    if (!merged.atlassianBaseUrl) merged.atlassianBaseUrl = current.atlassianBaseUrl;
    if (!merged.atlassianEmail) merged.atlassianEmail = current.atlassianEmail;
    if (!merged.atlassianApiToken) merged.atlassianApiToken = current.atlassianApiToken;
    if (!merged.openaiApiKey) merged.openaiApiKey = current.openaiApiKey;
    if (!merged.prodUrl) merged.prodUrl = commitSource === 'url' ? current.prodUrl : '';
    if (!merged.uatUrl) merged.uatUrl = commitSource === 'url' ? current.uatUrl : '';
    if (!merged.prodCommit) merged.prodCommit = commitSource === 'manual' ? current.prodCommit : '';
    if (!merged.uatCommit) merged.uatCommit = commitSource === 'manual' ? current.uatCommit : '';

    // Save to .env
    saveEnv({
      COMMIT_SOURCE: merged.commitSource,
      PROD_URL: merged.prodUrl,
      UAT_URL: merged.uatUrl,
      PROD_COMMIT: merged.prodCommit,
      UAT_COMMIT: merged.uatCommit,
      REPO_PATH: merged.repoPath,
      APP_PATH: merged.appPath,
      BRANCH: merged.branch,
      ATLASSIAN_EMAIL: merged.atlassianEmail || '',
      ATLASSIAN_API_TOKEN: merged.atlassianApiToken || '',
      ATLASSIAN_BASE_URL: merged.atlassianBaseUrl || '',
      OPENAI_API_KEY: merged.openaiApiKey || '',
    });

    console.log(chalk.green('  ✓ Configuration saved to .env\n'));
    return merged;
  }

  return current;
}

