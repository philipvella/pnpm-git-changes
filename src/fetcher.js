import axios from 'axios';
import * as cheerio from 'cheerio';

/**
 * Fetches a URL and extracts the content of <meta name="git-commit"> tag.
 * @param {string} url
 * @returns {Promise<string>} commit hash
 */
export async function fetchCommitFromUrl(url) {
  let response;
  try {
    response = await axios.get(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'pnpm-git-changes/1.0',
      },
      // Follow redirects
      maxRedirects: 5,
    });
  } catch (err) {
    throw new Error(`HTTP request failed for ${url}: ${err.message}`);
  }

  const $ = cheerio.load(response.data);

  // Try <meta name="git-commit" content="...">
  let commit = $('meta[name="git-commit"]').attr('content');

  // Also try property variant
  if (!commit) {
    commit = $('meta[property="git-commit"]').attr('content');
  }

  // Also try data attribute on body or html
  if (!commit) {
    commit = $('body').attr('data-git-commit') || $('html').attr('data-git-commit');
  }

  if (!commit || !commit.trim()) {
    throw new Error(
      `No <meta name="git-commit"> tag found at ${url}. ` +
      `Make sure the page includes: <meta name="git-commit" content="<commit-hash>">`
    );
  }

  return commit.trim();
}

