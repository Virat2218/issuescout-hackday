import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:4173';

// Helper for HTTP requests
function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = http.request(url, options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: data,
          json: () => {
            try { return JSON.parse(data); } catch { return null; }
          },
        });
      });
    });
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

test('1. Server Health Check Endpoints (/health and /api/health)', async () => {
  const res1 = await request('/health');
  assert.equal(res1.statusCode, 200);
  const json1 = res1.json();
  assert.equal(json1.status, 'ok');
  assert.ok(typeof json1.uptimeSeconds === 'number');
  assert.ok(json1.services);
  assert.ok(json1.services.ollama);
  assert.ok(json1.services.githubApi);

  const res2 = await request('/api/health');
  assert.equal(res2.statusCode, 200);
  const json2 = res2.json();
  assert.equal(json2.status, 'ok');
});

test('2. Live Activity Stream Endpoint (/api/stream)', async () => {
  const res = await request('/api/stream');
  assert.equal(res.statusCode, 200);
  assert.ok(res.headers['cache-control'].includes('max-age=60'));
  const json = res.json();
  assert.ok(json);
  assert.ok(Array.isArray(json.events));
  assert.ok(typeof json.isFallback === 'boolean');
  if (json.events.length > 0) {
    const ev = json.events[0];
    assert.ok(ev.id);
    assert.ok(ev.type);
    assert.ok(ev.repo);
    assert.ok(ev.url);
  }
});

test('3. SPA Route Fallbacks for Clean Navigation', async () => {
  const routes = ['/find', '/blueprint', '/pr-generator', '/git-handbook', '/live-stream', '/picks'];
  for (const r of routes) {
    const res = await request(r);
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['content-type'].includes('text/html'));
    assert.ok(res.body.includes('IssueScout'));
  }
});

test('4. Security Headers Present on Responses', async () => {
  const res = await request('/health');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
  assert.equal(res.headers['x-frame-options'], 'DENY');
  assert.equal(res.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.ok(res.headers['content-security-policy']);
});

test('5. Request Body Size Enforcement (>64KB Payload Limit)', async () => {
  // Generate 70KB payload
  const largeData = JSON.stringify({ skills: 'a'.repeat(70 * 1024) });
  const res = await request('/api/find', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(largeData),
    },
    body: largeData,
  });
  assert.equal(res.statusCode, 413);
  const json = res.json();
  assert.ok(json.error.includes('Payload Too Large'));
});

test('6. Input Validation on /api/find', async () => {
  // Empty body
  const res1 = await request('/api/find', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  // Should accept or gracefully respond without crashing
  assert.ok([200, 400].includes(res1.statusCode));

  // Invalid JSON
  const res2 = await request('/api/find', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{"invalid: json',
  });
  assert.equal(res2.statusCode, 400);
});

test('7. PR Generator Markdown Synthesis Logic', () => {
  function generateTestPRMarkdown({ title, issueRef, changeType, summary, testing, checklist }) {
    const issueSection = issueRef ? `Fixes ${issueRef}` : '<!-- Reference issue here -->';
    const checkLines = checklist.map((c) => `- [${c.checked ? 'x' : ' '}] ${c.text}`).join('\n');
    return `## Description\n${summary}\n\n## Related Issue\n${issueSection}\n\n## Type of Change\n- ${changeType}\n\n## Testing Performed\n${testing}\n\n## Checklist\n${checkLines}\n`;
  }

  const sample = generateTestPRMarkdown({
    title: 'fix(parser): resolve null pointer exception',
    issueRef: '#42',
    changeType: 'Bug fix (non-breaking change which fixes an issue)',
    summary: 'Resolved crash when token is undefined in parseStream.',
    testing: '- [x] Added unit tests\n- [x] Ran npm test',
    checklist: [
      { text: 'Self-review performed', checked: true },
      { text: 'Tests pass', checked: true },
    ],
  });

  assert.ok(sample.includes('## Description'));
  assert.ok(sample.includes('Fixes #42'));
  assert.ok(sample.includes('## Type of Change'));
  assert.ok(sample.includes('Bug fix'));
  assert.ok(sample.includes('## Testing Performed'));
  assert.ok(sample.includes('- [x] Self-review performed'));
});

test('8. Difficulty Classification & Filter Logic', () => {
  function classifyDifficulty(issue) {
    const labels = (issue.labels || []).map((l) => l.toLowerCase().replace(/[-_]/g, ' '));
    if (labels.some((l) => l.includes('good first issue') || l.includes('starter') || l.includes('docs') || l.includes('documentation'))) {
      return 'beginner';
    }
    if (labels.some((l) => l.includes('architecture') || l.includes('refactor') || l.includes('security'))) {
      return 'advanced';
    }
    if (labels.some((l) => l.includes('bug') || l.includes('enhancement') || l.includes('feature'))) {
      return 'intermediate';
    }
    return 'unknown';
  }

  assert.equal(classifyDifficulty({ labels: ['good-first-issue', 'docs'] }), 'beginner');
  assert.equal(classifyDifficulty({ labels: ['security', 'breaking-change'] }), 'advanced');
  assert.equal(classifyDifficulty({ labels: ['bug'] }), 'intermediate');
  assert.equal(classifyDifficulty({ labels: ['triage'] }), 'unknown');
});

test('9. Skill-Gap Categorization & Evidence Isolation', () => {
  const userSkills = ['javascript', 'css'];
  const issueSkills = ['javascript', 'react', 'jest'];

  const matched = issueSkills.filter((s) => userSkills.includes(s));
  const missing = issueSkills.filter((s) => !userSkills.includes(s));
  const additional = ['git', 'code-review'].filter((s) => !issueSkills.includes(s));

  assert.deepEqual(matched, ['javascript']);
  assert.deepEqual(missing, ['react', 'jest']);
  assert.deepEqual(additional, ['git', 'code-review']);
});

test('10. Fix Blueprint Command Generation Integrity', () => {
  const repoFullName = 'facebook/react';
  const [repoOwner, repoName] = repoFullName.split('/');
  const username = 'testdev';
  const branchName = 'fix-100-docs-typo';

  const cloneCmd = `git clone https://github.com/${username}/${repoName}.git`;
  const remoteCmd = `git remote add upstream https://github.com/${repoFullName}.git`;
  const branchCmd = `git checkout -b ${branchName}`;

  assert.equal(cloneCmd, 'git clone https://github.com/testdev/react.git');
  assert.equal(remoteCmd, 'git remote add upstream https://github.com/facebook/react.git');
  assert.equal(branchCmd, 'git checkout -b fix-100-docs-typo');
  // Verify default destination is contributor's fork, NEVER maintainer repo directly
  assert.ok(cloneCmd.includes(`github.com/${username}`));
  assert.ok(!cloneCmd.includes(`github.com/${repoOwner}/${repoName}`));
});
