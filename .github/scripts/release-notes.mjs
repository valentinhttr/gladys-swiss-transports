import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function extractReleaseNotes(changelog, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Expected a version such as 1.0.0.');
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((line) => {
    const match = /^## (?:\[([^\]]+)\]|(\S+))(?:\s|$)/.exec(line);
    return match && (match[1] ?? match[2]) === version;
  });
  if (start === -1) throw new Error(`Missing CHANGELOG.md section for ${version}.`);
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^##\s|^\[[^\]]+\]:\s/.test(line)) break;
    body.push(line);
  }
  const notes = body.join('\n').trim();
  if (!notes) throw new Error(`Empty CHANGELOG.md section for ${version}.`);
  return `${notes}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(
      extractReleaseNotes(readFileSync('CHANGELOG.md', 'utf8'), process.argv[2]),
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
