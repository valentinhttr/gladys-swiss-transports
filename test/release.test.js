import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';
import { extractReleaseNotes } from '../.github/scripts/release-notes.mjs';

test('release notes contain only the exact version section and preserve Markdown', () => {
  const changelog =
    '# Changelog\n\n## [Unreleased]\n\n- Future.\n\n## [1.0.10] - 2026-10-13\n\n- Other.\n\n## [1.0.1] - 2026-10-12\n\n### Fixed\n\n- Keep `code` and $variables.\n\n## [1.0.0]\n\n- Initial.\n';
  assert.equal(
    extractReleaseNotes(changelog, '1.0.1'),
    '### Fixed\n\n- Keep `code` and $variables.\n',
  );
});

test('release notes accept unbracketed headings and exclude comparison links', () => {
  assert.equal(
    extractReleaseNotes(
      '## 1.0.0 - 2026-10-12\r\n\r\n- Initial.\r\n\r\n[1.0.0]: https://example.com\r\n',
      '1.0.0',
    ),
    '- Initial.\n',
  );
});

test('missing or empty changelog sections fail instead of generating notes', () => {
  assert.throws(() => extractReleaseNotes('## [1.0.0]\n- Initial.', '1.0.1'), /Missing/);
  assert.throws(
    () => extractReleaseNotes('## [1.0.1]\n\n## [1.0.0]\n- Initial.', '1.0.1'),
    /Empty/,
  );
  assert.throws(() => extractReleaseNotes('', 'invalid'), /Expected/);
});

test('release rolls Unreleased content once without losing prior releases', () => {
  const original =
    '# Changelog\n\n## [Unreleased]\n\n- New feature.\n\n## [1.0.0] - 2026-10-12\n\n- Initial.\n';
  const result = rollChangelog(original, '1.1.0', '2026-10-13');
  assert.match(result, /## \[Unreleased\]\n\n## \[1.1.0\] - 2026-10-13\n\n- New feature/);
  assert.match(result, /## \[1.0.0\]/);
  assert.equal(rollChangelog(result, '1.1.0', '2026-10-13'), result);
});
