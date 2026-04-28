import OpenAI from 'openai';

/**
 * Generate two concise "What Changed" bullet strings using OpenAI.
 * Returns [mainAreasBullet, notableChangesBullet].
 * Falls back to null values if AI is unavailable or fails.
 *
 * @param {Array<{shortHash, message, files}>} commits
 * @param {string[]} tickets
 * @param {Record<string, {summary, status}>} ticketDetails
 * @param {{ openaiApiKey: string }} config
 * @returns {Promise<[string|null, string|null]>}
 */
export async function generateWhatChangedBullets(commits, tickets, ticketDetails, config) {
  if (!config.openaiApiKey) return [null, null];

  try {
    const client = new OpenAI({ apiKey: config.openaiApiKey });

    const ticketList = tickets
      .map((t) => {
        const d = ticketDetails[t];
        return d?.summary && d.summary !== '(Could not fetch)'
          ? `${t}: ${d.summary}`
          : t;
      })
      .join('\n');

    const commitList = commits
      .slice(0, 20)
      .map((c) => {
        const nonLock = (c.files || []).filter(
          (f) => !f.endsWith('.lock') && f !== 'pnpm-lock.yaml'
        );
        const preview = nonLock.slice(0, 4).join(', ') + (nonLock.length > 4 ? '…' : '');
        return `- [${c.shortHash}] ${c.message}${preview ? ` (${preview})` : ''}`;
      })
      .join('\n');

    const prompt = `You are a technical release assistant writing a changelog for a production deployment.

Given the Jira tickets and commits below, write exactly TWO concise bullet points:
1. "The main areas updated are …" — summarise the functional areas or features touched (based on ticket titles).
2. "Notable implementation changes include …" — summarise the most impactful code-level changes (based on commit messages).

Rules:
- Each bullet must start with the phrase shown above.
- Keep each bullet to one sentence, max 30 words.
- Do NOT include ticket IDs or commit hashes in the output.
- Do NOT add any other text, headings, or bullets.

Jira Tickets:
${ticketList || '(none)'}

Commits:
${commitList || '(none)'}`;

    const completion = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 120,
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content?.trim() || '';
    const lines = raw.split('\n').map((l) => l.replace(/^[-*\d.]+\s*/, '').trim()).filter(Boolean);

    const mainAreas = lines[0] || null;
    const notableChanges = lines[1] || null;
    return [mainAreas, notableChanges];
  } catch {
    return [null, null];
  }
}



function buildFallbackChangelog(commits, tickets, ticketDetails) {
  const ticketLines = tickets.length
    ? tickets.slice(0, 8).map((t) => {
        const detail = ticketDetails[t];
        return detail?.summary
          ? `- ${t}: ${detail.summary} (${detail.status || 'Unknown'})`
          : `- ${t}`;
      })
    : ['- None identified from commit messages'];

  const commitLines = commits.length
    ? commits.slice(0, 8).map((c) => `- ${c.shortHash}: ${c.message}`)
    : ['- None'];

  return [
    '# Changelog',
    '',
    '## 🚀 Highlights',
    '- Production differs from UAT with deployable changes relevant to the selected app.',
    '',
    '## 🎫 Jira Tickets',
    ...ticketLines,
    '',
    '## 🛠️ Commits Included',
    ...commitLines,
    '',
    '## ⚠️ Notes',
    '- Generated fallback summary because AI response formatting was incomplete.',
  ].join('\n');
}

/**
 * Generate an AI summary of the changes using OpenAI.
 *
 * @param {Array<{hash, message, files}>} commits
 * @param {string[]} tickets
 * @param {Record<string, {summary, status, url}>} ticketDetails
 * @param {{ openaiApiKey: string }} config
 * @returns {Promise<string>}
 */
export async function generateSummary(commits, tickets, ticketDetails, config) {
  const client = new OpenAI({ apiKey: config.openaiApiKey });

  // Build context for the prompt
  const ticketList = tickets
    .map((t) => {
      const detail = ticketDetails[t];
      if (detail && detail.summary !== '(Could not fetch)') {
        return `- ${t}: ${detail.summary} [${detail.status}]`;
      }
      return `- ${t}`;
    })
    .join('\n');

  // Include commit messages (excluding lock-file-only commits)
  const commitList = commits
    .map((c) => {
      const nonLock = c.files.filter(
        (f) => !f.endsWith('.lock') && f !== 'pnpm-lock.yaml'
      );
      const filePreview = nonLock.slice(0, 5).join(', ') + (nonLock.length > 5 ? '...' : '');
      return `- [${c.shortHash}] ${c.message}${filePreview ? ` (files: ${filePreview})` : ''}`;
    })
    .join('\n');

  const prompt = `You are a technical release assistant. Given the following git commits and JIRA tickets that represent changes deployed to production (compared to the UAT environment), write a concise, human-readable summary of what changed.

Focus on:
- The functional areas affected
- The impact to end users
- Any notable fixes or features

JIRA Tickets:
${ticketList || '(none found)'}

Commits:
${commitList}

Return ONLY markdown in this exact changelog structure and keep emoji icons in headings:

# Changelog
## 🚀 Highlights
- ...
## ✨ Features
- ...
## 🐛 Fixes
- ...
## 🎫 Jira Tickets
- TICKET-ID: summary (status)
## ⚠️ Risk / Follow-up
- ...

Rules:
- Use 1-3 bullets per section.
- If a section has no items, output one bullet: "- None".
- Keep each bullet concise and specific.
- Synthesize the meaning of the changes; do not only restate ticket titles.`;

  const completion = await client.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 500,
    temperature: 0.4,
  });

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    return buildFallbackChangelog(commits, tickets, ticketDetails);
  }

  // Guardrail: if the model ignores formatting rules, keep output useful and consistent.
  const looksLikeChangelog = content.includes('# Changelog') && content.includes('## ');
  const hasEmoji = /[\u{1F300}-\u{1FAFF}]/u.test(content);
  if (!looksLikeChangelog || !hasEmoji) {
    return buildFallbackChangelog(commits, tickets, ticketDetails);
  }

  return content;
}

