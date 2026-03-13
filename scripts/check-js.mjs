import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT_DIR = process.cwd();
const ROOT_FILES = ['background.js', 'content.js', 'logger.js', 'meta.js', 'sidepanel.js'];
const ROOT_DIRS = ['content', 'modules', 'sidepanel', 'scripts'];
const VALID_EXTENSIONS = new Set(['.js', '.mjs']);

function hasValidExtension(filePath) {
  return [...VALID_EXTENSIONS].some((extension) => filePath.endsWith(extension));
}

function collectFiles(entryPath, bucket) {
  const stat = statSync(entryPath);
  if (stat.isDirectory()) {
    const names = readdirSync(entryPath);
    names
      .sort((left, right) => left.localeCompare(right))
      .forEach((name) => collectFiles(join(entryPath, name), bucket));
    return;
  }

  if (stat.isFile() && hasValidExtension(entryPath)) {
    bucket.push(entryPath);
  }
}

function buildTargetList() {
  const files = [];

  ROOT_FILES.forEach((name) => {
    collectFiles(join(ROOT_DIR, name), files);
  });

  ROOT_DIRS.forEach((name) => {
    collectFiles(join(ROOT_DIR, name), files);
  });

  return files;
}

const targets = buildTargetList();
const failures = [];

targets.forEach((filePath) => {
  const relativePath = relative(ROOT_DIR, filePath);
  process.stdout.write(`Checking ${relativePath}\n`);

  const result = spawnSync(process.execPath, ['--check', filePath], {
    cwd: ROOT_DIR,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    failures.push({
      filePath: relativePath,
      stderr: result.stderr?.trim() || result.stdout?.trim() || 'Unknown error'
    });
  }
});

if (failures.length) {
  process.stderr.write('\nJavaScript syntax check failed.\n');
  failures.forEach((failure) => {
    process.stderr.write(`- ${failure.filePath}\n${failure.stderr}\n`);
  });
  process.exit(1);
}

process.stdout.write(`\nChecked ${targets.length} files successfully.\n`);
