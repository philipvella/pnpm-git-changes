import { execSync } from 'child_process';

/**
 * Run a git command in the given repo directory.
 */
function git(repoPath, args) {
  return execSync(`git -C "${repoPath}" ${args}`, {
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/**
 * Get an array of commits between fromCommit (exclusive) and toCommit (inclusive).
 * Each commit has: { hash, shortHash, message, author, files }
 *
 * @param {string} repoPath  - absolute path to git repo
 * @param {string} fromCommit - older commit (e.g. UAT commit)
 * @param {string} toCommit   - newer commit (e.g. PROD commit)
 * @returns {Promise<Array<{hash: string, shortHash: string, message: string, author: string, files: string[]}>>}
 */
export async function getCommitsWithFiles(repoPath, fromCommit, toCommit) {
  // Fetch to ensure we have all commits
  try {
    git(repoPath, 'fetch --quiet');
  } catch (_) {
    // Non-fatal – may not have network or remote
  }

  // Get commit list: hash<SEP>message<SEP>author
  const SEP = '|||';
  let logOutput;
  try {
    logOutput = git(repoPath, `log --pretty=format:"%H${SEP}%s${SEP}%an" ${fromCommit}..${toCommit}`);
  } catch (err) {
    throw new Error(
      `Could not get git log between ${fromCommit} and ${toCommit}.\n` +
      `Make sure both commits exist in the local repo.\n${err.message}`
    );
  }

  if (!logOutput) return [];

  const lines = logOutput.split('\n').filter(Boolean);

  const commits = lines.map((line) => {
    const parts = line.split(SEP);
    const hash = parts[0];
    const message = parts[1] || '';
    const author = parts[2] || '';
    return { hash, shortHash: hash.substring(0, 7), message, author, files: [] };
  });

  // Get changed files for each commit (batch via name-only diff)
  // Use diff-tree for efficiency
  for (const commit of commits) {
    try {
      const filesOutput = git(
        repoPath,
        `diff-tree --no-commit-id -r --name-only ${commit.hash}`
      );
      commit.files = filesOutput ? filesOutput.split('\n').filter(Boolean) : [];
    } catch (_) {
      commit.files = [];
    }
  }

  return commits;
}

/**
 * Get all files changed between two commits (flat list, deduplicated).
 *
 * @param {string} repoPath
 * @param {string} fromCommit
 * @param {string} toCommit
 * @returns {string[]}
 */
export function getChangedFiles(repoPath, fromCommit, toCommit) {
  const output = git(repoPath, `diff --name-only ${fromCommit}..${toCommit}`);
  return output ? output.split('\n').filter(Boolean) : [];
}

