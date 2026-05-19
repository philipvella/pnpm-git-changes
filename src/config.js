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
  const hasSaved = current.prodCommit && current.uatCommit && current.repoPath && current.appPath;

  let updateMode = false;

  if (hasSaved) {
    console.log(chalk.gray('\nSaved configuration found:'));
    console.log(chalk.gray(`  Repo path      : ${current.repoPath}`));
    console.log(chalk.gray(`  App path       : ${current.appPath}`));
    console.log(chalk.gray(`  Branch         : ${current.branch}`));
    console.log(chalk.gray(`  Prod commit    : ${current.prodCommit}`));
    console.log(chalk.gray(`  UAT commit     : ${current.uatCommit}`));
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

    const answers = await inquirer.prompt([
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
        message: current.atlassianEmail ? 'Keep current Jira credentials?' : 'Configure Jira credentials?',
        default: !!current.atlassianEmail,
      },
      {
        type: 'confirm',
        name: 'configureOpenAI',
        message: current.openaiApiKey ? 'Keep current OpenAI API key?' : 'Configure OpenAI API key?',
        default: !!current.openaiApiKey,
      },
    ]);

    let jiraAnswers = {};
    const shouldConfigureJira = current.atlassianEmail
      ? !answers.configureJira  // "Keep current?" No → re-enter
      : answers.configureJira;  // "Configure?" Yes → enter
    if (shouldConfigureJira) {
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
    const shouldConfigureOpenAI = current.openaiApiKey
      ? !answers.configureOpenAI  // "Keep current?" No → re-enter
      : answers.configureOpenAI;  // "Configure?" Yes → enter
    if (shouldConfigureOpenAI) {
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
      ...answers,
      ...jiraAnswers,
      ...openaiAnswers,
      configureJira: undefined,
      configureOpenAI: undefined,
    };

    if (!merged.atlassianBaseUrl) merged.atlassianBaseUrl = current.atlassianBaseUrl;
    if (!merged.atlassianEmail) merged.atlassianEmail = current.atlassianEmail;
    if (!merged.atlassianApiToken) merged.atlassianApiToken = current.atlassianApiToken;
    if (!merged.openaiApiKey) merged.openaiApiKey = current.openaiApiKey;

    saveEnv({
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
