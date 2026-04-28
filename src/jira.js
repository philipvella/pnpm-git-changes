import axios from 'axios';

// Pattern: 2–10 uppercase letters, a dash, then digits
// e.g. PROJ-1234, AB-99, PAYMENTS-12345
const JIRA_TICKET_RE = /\b([A-Z]{2,10}-\d+)\b/g;

/**
 * Extract unique JIRA ticket IDs from an array of commit objects.
 * @param {Array<{message: string}>} commits
 * @returns {string[]} sorted unique ticket IDs
 */
export function extractJiraTickets(commits) {
  const seen = new Set();
  for (const commit of commits) {
    const matches = commit.message.match(JIRA_TICKET_RE);
    if (matches) {
      for (const m of matches) seen.add(m);
    }
  }
  return Array.from(seen).sort();
}

/**
 * Fetch ticket details from the JIRA Cloud REST API.
 *
 * @param {string[]} tickets  - array of ticket IDs like ["PROJ-1", "PROJ-2"]
 * @param {{ atlassianEmail, atlassianApiToken, atlassianBaseUrl }} config
 * @returns {Promise<Record<string, {summary: string, status: string, url: string}>>}
 */
export async function fetchJiraDetails(tickets, config) {
  const { atlassianEmail, atlassianApiToken, atlassianBaseUrl } = config;

  const auth = Buffer.from(`${atlassianEmail}:${atlassianApiToken}`).toString('base64');
  const baseUrl = atlassianBaseUrl.replace(/\/$/, '');

  const results = {};

  // Fetch in parallel (batched to avoid rate limits)
  const BATCH_SIZE = 10;
  for (let i = 0; i < tickets.length; i += BATCH_SIZE) {
    const batch = tickets.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (ticket) => {
        try {
          const response = await axios.get(
            `${baseUrl}/rest/api/3/issue/${ticket}?fields=summary,status`,
            {
              headers: {
                Authorization: `Basic ${auth}`,
                Accept: 'application/json',
              },
              timeout: 10000,
            }
          );
          const { fields } = response.data;
          results[ticket] = {
            summary: fields.summary,
            status: fields.status?.name || 'Unknown',
            url: `${baseUrl}/browse/${ticket}`,
          };
        } catch (err) {
          // Don't fail the whole run for a single ticket
          results[ticket] = {
            summary: '(Could not fetch)',
            status: err.response?.status === 404 ? 'Not Found' : 'Error',
            url: `${baseUrl}/browse/${ticket}`,
          };
        }
      })
    );
  }

  return results;
}

