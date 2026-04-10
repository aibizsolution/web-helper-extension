import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(SCRIPT_DIR, '..');
const RELEASE_DIR = join(ROOT_DIR, 'release');
const INCLUDED_ROOT_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'logger.js',
  'meta.js',
  'sidepanel.html',
  'sidepanel.js'
];
const INCLUDED_DIRS = ['content', 'icons', 'modules', 'sidepanel', 'styles'];

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function readLastEdited(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const match = source.match(/export const LAST_EDITED = '(\d{4}-\d{2}-\d{2})';/);

  if (!match) {
    throw new Error('meta.js에서 LAST_EDITED 값을 찾지 못했습니다.');
  }

  return match[1];
}

function readReadmeReleaseMetadata(filePath) {
  const source = readFileSync(filePath, 'utf8');
  const versionMatch = source.match(/- 버전:\s*`([^`]+)`/);
  const lastUpdatedMatch = source.match(/- 마지막 정리:\s*`(\d{4}-\d{2}-\d{2})`/);

  if (!versionMatch) {
    throw new Error('README.md에서 현재 버전 값을 찾지 못했습니다.');
  }

  if (!lastUpdatedMatch) {
    throw new Error('README.md에서 마지막 정리 날짜를 찾지 못했습니다.');
  }

  return {
    version: versionMatch[1].trim(),
    lastUpdated: lastUpdatedMatch[1]
  };
}

function getSeoulDateString() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(new Date());
}

function assertReleasePreconditions() {
  const manifest = readJson(join(ROOT_DIR, 'manifest.json'));
  const packageJson = readJson(join(ROOT_DIR, 'package.json'));
  const lastEdited = readLastEdited(join(ROOT_DIR, 'meta.js'));
  const readme = readReadmeReleaseMetadata(join(ROOT_DIR, 'README.md'));
  const today = getSeoulDateString();

  if (manifest.version !== packageJson.version) {
    throw new Error(`manifest.json(${manifest.version})과 package.json(${packageJson.version}) 버전이 다릅니다.`);
  }

  if (readme.version !== manifest.version) {
    throw new Error(`README.md 버전(${readme.version})과 manifest.json 버전(${manifest.version})이 다릅니다.`);
  }

  if (lastEdited !== today) {
    throw new Error(`meta.js LAST_EDITED(${lastEdited})가 오늘 날짜(${today})와 다릅니다. 릴리즈 전에 footer 날짜를 갱신하세요.`);
  }

  if (readme.lastUpdated !== today) {
    throw new Error(`README.md 마지막 정리(${readme.lastUpdated})가 오늘 날짜(${today})와 다릅니다. 릴리즈 전에 README 정보를 갱신하세요.`);
  }

  if (readme.lastUpdated !== lastEdited) {
    throw new Error(`README.md 마지막 정리(${readme.lastUpdated})와 meta.js LAST_EDITED(${lastEdited})가 다릅니다.`);
  }

  return {
    version: manifest.version,
    lastEdited,
    readmeLastUpdated: readme.lastUpdated
  };
}

function prepareReleasePaths(version) {
  const folderName = `web-helper-extension-v${version}`;
  const stagingDir = join(RELEASE_DIR, folderName);
  const zipPath = join(RELEASE_DIR, `${folderName}.zip`);

  mkdirSync(RELEASE_DIR, { recursive: true });
  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(zipPath, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  return { folderName, stagingDir, zipPath };
}

function copyReleaseFiles(stagingDir) {
  INCLUDED_ROOT_FILES.forEach((name) => {
    cpSync(join(ROOT_DIR, name), join(stagingDir, name));
  });

  INCLUDED_DIRS.forEach((name) => {
    cpSync(join(ROOT_DIR, name), join(stagingDir, name), {
      recursive: true
    });
  });
}

function runCommand(command, args, { cwd = ROOT_DIR, env = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env
    }
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || `${command} 실행 실패`);
  }
}

function createZip(stagingDir, zipPath) {
  if (process.platform === 'win32') {
    runCommand('tar', ['-a', '-cf', zipPath, '-C', stagingDir, '.']);
    return;
  }

  runCommand('zip', ['-qr', zipPath, '.'], {
    cwd: stagingDir
  });
}

function main() {
  const { version, lastEdited, readmeLastUpdated } = assertReleasePreconditions();
  const { stagingDir, zipPath } = prepareReleasePaths(version);

  copyReleaseFiles(stagingDir);
  createZip(stagingDir, zipPath);

  if (!existsSync(zipPath)) {
    throw new Error('릴리즈 zip 생성에 실패했습니다.');
  }

  process.stdout.write(`Release package ready: ${zipPath}\n`);
  process.stdout.write(`Release folder ready: ${stagingDir}\n`);
  process.stdout.write(`Verified footer date: ${lastEdited}\n`);
  process.stdout.write(`Verified README release date: ${readmeLastUpdated}\n`);
}

main();
