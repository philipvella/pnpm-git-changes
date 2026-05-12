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

const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'];
const SOURCE_FILE_PATTERN = '**/*.{js,jsx,ts,tsx,mjs,cjs}';
const SOURCE_IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/__tests__/**',
  '**/*.test.*',
  '**/*.spec.*',
  '**/*.stories.*',
];

function isLockFile(filePath) {
  return LOCK_FILE_PATTERNS.some((re) => re.test(filePath));
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function isRelativeSpecifier(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function parseWorkspacePackageSpecifier(specifier) {
  if (!specifier || specifier.startsWith('.') || specifier.startsWith('/')) return null;
  const parts = specifier.split('/');
  const pkgName = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  const subpath = specifier.slice(pkgName.length).replace(/^\//, '');
  return { pkgName, subpath };
}

function parseImportSpecifiers(content) {
  const specifiers = new Set();
  const patterns = [
    /import\s+[^'"`]*?from\s*['"]([^'"`]+)['"]/g,
    /import\s*['"]([^'"`]+)['"]/g,
    /export\s+[^'"`]*?from\s*['"]([^'"`]+)['"]/g,
    /require\(\s*['"]([^'"`]+)['"]\s*\)/g,
    /import\(\s*['"]([^'"`]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const spec = match[1]?.trim();
      if (spec) specifiers.add(spec);
    }
  }

  return [...specifiers];
}

function resolveAsFileOrDirectory(basePath) {
  if (fs.existsSync(basePath) && fs.statSync(basePath).isFile()) return basePath;

  for (const ext of RESOLVE_EXTENSIONS) {
    const candidate = `${basePath}${ext}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }

  if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
    const pkgJsonPath = path.join(basePath, 'package.json');
    if (fs.existsSync(pkgJsonPath)) {
      try {
        const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
        const entryCandidates = [pkgJson.module, pkgJson.main, pkgJson.types].filter(Boolean);
        for (const entry of entryCandidates) {
          const resolved = resolveAsFileOrDirectory(path.resolve(basePath, entry));
          if (resolved) return resolved;
        }
      } catch (_) {
        // ignore malformed package.json
      }
    }

    for (const ext of RESOLVE_EXTENSIONS) {
      const indexCandidate = path.join(basePath, `index${ext}`);
      if (fs.existsSync(indexCandidate) && fs.statSync(indexCandidate).isFile()) return indexCandidate;
    }
  }

  return null;
}

function resolveWorkspaceSpecifier(repoPath, workspacePkgMap, specifier) {
  const parsed = parseWorkspacePackageSpecifier(specifier);
  if (!parsed) return null;

  const depDir = workspacePkgMap.get(parsed.pkgName);
  if (!depDir) return null;

  const depRoot = path.join(repoPath, depDir);

  if (parsed.subpath) {
    return resolveAsFileOrDirectory(path.join(depRoot, parsed.subpath));
  }

  return resolveAsFileOrDirectory(depRoot);
}

async function buildUsedFilesGraph(repoPath, appRelPath, workspacePkgMap) {
  const appRoot = path.join(repoPath, appRelPath);
  const roots = await glob(SOURCE_FILE_PATTERN, {
    cwd: appRoot,
    absolute: true,
    nodir: true,
    ignore: SOURCE_IGNORE,
  });

  const queue = [...roots];
  const visited = new Set();
  const usedFiles = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    if (!current.startsWith(repoPath)) continue;
    usedFiles.add(toPosixPath(path.relative(repoPath, current)));

    let content = '';
    try {
      content = fs.readFileSync(current, 'utf-8');
    } catch (_) {
      continue;
    }

    const specifiers = parseImportSpecifiers(content);
    for (const specifier of specifiers) {
      let resolved = null;
      if (isRelativeSpecifier(specifier)) {
        resolved = resolveAsFileOrDirectory(path.resolve(path.dirname(current), specifier));
      } else {
        resolved = resolveWorkspaceSpecifier(repoPath, workspacePkgMap, specifier);
      }

      if (!resolved) continue;
      if (!resolved.startsWith(repoPath)) continue;
      if (visited.has(resolved)) continue;
      queue.push(resolved);
    }
  }

  return usedFiles;
}

function buildUsedWorkspaceDirs(usedFiles, workspacePkgMap) {
  const usedDirs = new Set();
  const workspaceDirs = [...workspacePkgMap.values()];
  for (const file of usedFiles) {
    for (const dir of workspaceDirs) {
      if (file.startsWith(dir)) {
        usedDirs.add(dir);
      }
    }
  }
  return usedDirs;
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
  let usedFiles = new Set();
  try {
    usedFiles = await buildUsedFilesGraph(repoPath, appRelPath, workspacePkgMap);
  } catch (_) {
    // Fall back to path-level filtering below when usage graph cannot be built.
  }
  const usedWorkspaceDirs = buildUsedWorkspaceDirs(usedFiles, workspacePkgMap);
  const appDir = appRelPath.endsWith('/') ? appRelPath : `${appRelPath}/`;

  const isPathRelevant = (file) => Array.from(relevantPaths).some((dir) => file.startsWith(dir));

  const isFileUsageRelevant = (file) => {
    if (file.startsWith(appDir)) return true;
    if (usedFiles.has(file)) return true;
    return [...usedWorkspaceDirs].some((dir) => file === `${dir}package.json`);
  };

  const shouldUseUsageFilter = usedFiles.size > 0;

  return commits.filter((commit) => {
    const relevant = commit.files.filter((file) => {
      const normalizedFile = toPosixPath(file);
      if (isLockFile(normalizedFile)) return false;
      if (shouldUseUsageFilter) return isFileUsageRelevant(normalizedFile);
      return isPathRelevant(normalizedFile);
    });
    return relevant.length > 0;
  });
}

