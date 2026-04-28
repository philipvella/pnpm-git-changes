import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { glob } from 'glob';

const LOCK_FILE_PATTERNS = [
  /\.lock$/i,
  /pnpm-lock\.yaml$/i,
  /yarn\.lock$/i,
  /package-lock\.json$/i,
];

function isLockFile(filePath) {
  return LOCK_FILE_PATTERNS.some((re) => re.test(filePath));
}

/**
 * Read pnpm-workspace.yaml and return an array of glob patterns.
 * Returns null if no workspace file is found (non-monorepo).
 */
function readWorkspacePatterns(repoPath) {
  const workspaceFile = path.join(repoPath, 'pnpm-workspace.yaml');
  if (!fs.existsSync(workspaceFile)) return null;
  const content = yaml.load(fs.readFileSync(workspaceFile, 'utf-8'));
  return content?.packages || [];
}

/**
 * Resolve workspace package directories from glob patterns.
 * Returns a Map of packageName → relativeDir.
 *
 * @param {string} repoPath
 * @param {string[]} patterns
 * @returns {Map<string, string>}
 */
async function resolveWorkspacePackages(repoPath, patterns) {
  const pkgMap = new Map();

  for (const pattern of patterns) {
    // Find matching directories
    const matches = await glob(pattern, {
      cwd: repoPath,
      absolute: false,
      // Only directories
      ignore: ['**/node_modules/**'],
    });

    for (const match of matches) {
      const pkgJsonPath = path.join(repoPath, match, 'package.json');
      if (!fs.existsSync(pkgJsonPath)) continue;
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        if (pkg.name) {
          pkgMap.set(pkg.name, match.endsWith('/') ? match : match + '/');
        }
      } catch (_) {
        // skip malformed package.json
      }
    }
  }

  return pkgMap;
}

/**
 * Get the set of workspace package names (and their paths) that the target app depends on.
 * Traverses dependencies + devDependencies from the app's package.json.
 *
 * @param {string} repoPath
 * @param {string} appRelPath  - relative path inside repo, e.g. "apps/my-app"
 * @param {Map<string, string>} workspacePkgMap - name → relDir
 * @returns {Set<string>} set of relevant relative directory prefixes
 */
function getAppRelevantPaths(repoPath, appRelPath, workspacePkgMap) {
  const relevantPaths = new Set();

  // Always include the app directory itself
  const appDir = appRelPath.endsWith('/') ? appRelPath : appRelPath + '/';
  relevantPaths.add(appDir);

  // Read app's package.json
  const appPkgPath = path.join(repoPath, appRelPath, 'package.json');
  if (!fs.existsSync(appPkgPath)) return relevantPaths;

  let appPkg;
  try {
    appPkg = JSON.parse(fs.readFileSync(appPkgPath, 'utf-8'));
  } catch (_) {
    return relevantPaths;
  }

  const allDeps = {
    ...appPkg.dependencies,
    ...appPkg.devDependencies,
    ...appPkg.peerDependencies,
  };

  // BFS to find transitive workspace dependencies
  const visited = new Set();
  const queue = Object.keys(allDeps);

  while (queue.length > 0) {
    const depName = queue.shift();
    if (visited.has(depName)) continue;
    visited.add(depName);

    const depDir = workspacePkgMap.get(depName);
    if (!depDir) continue; // not a workspace package, skip

    relevantPaths.add(depDir);

    // Also traverse its dependencies
    const depPkgPath = path.join(repoPath, depDir, 'package.json');
    if (fs.existsSync(depPkgPath)) {
      try {
        const depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf-8'));
        const transitiveDeps = {
          ...depPkg.dependencies,
          ...depPkg.devDependencies,
        };
        queue.push(...Object.keys(transitiveDeps));
      } catch (_) {
        // skip
      }
    }
  }

  return relevantPaths;
}

/**
 * Filter commits to only those that include changes relevant to the app.
 * - Excludes lock files
 * - Only includes commits touching the app dir or its workspace dependencies
 *
 * @param {Array<{hash, message, files}>} commits
 * @param {string} repoPath
 * @param {string} appRelPath
 * @returns {Promise<Array>}
 */
export async function filterRelevantCommits(commits, repoPath, appRelPath) {
  const patterns = readWorkspacePatterns(repoPath);

  // Not a pnpm workspace — just filter lock files
  if (!patterns || patterns.length === 0) {
    return commits.filter((commit) => {
      const nonLock = commit.files.filter((f) => !isLockFile(f));
      return nonLock.length > 0;
    });
  }

  const workspacePkgMap = await resolveWorkspacePackages(repoPath, patterns);
  const relevantPaths = getAppRelevantPaths(repoPath, appRelPath, workspacePkgMap);

  return commits.filter((commit) => {
    const relevant = commit.files.filter((file) => {
      if (isLockFile(file)) return false;
      // Check if the file belongs to any relevant path
      return Array.from(relevantPaths).some((dir) => file.startsWith(dir));
    });
    return relevant.length > 0;
  });
}

