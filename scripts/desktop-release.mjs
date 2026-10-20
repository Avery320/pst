import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PLATFORMS = {
  'windows-x64': { target: 'x86_64-pc-windows-msvc', bundle: 'nsis', extension: '.exe', suffix: 'windows-x64-setup.exe' },
  'macos-universal': { target: 'universal-apple-darwin', bundle: 'dmg', extension: '.dmg', suffix: 'macos-universal.dmg' },
};
const VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const COMMIT = /^[a-f0-9]{40}$/;
const CRATE_ARCHIVE = /^[A-Za-z0-9][A-Za-z0-9._+-]*\.crate$/;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const check = (condition, message) => { if (!condition) throw new Error(message); };

function packageSection(toml) {
  const section = toml.match(/^\[package\]\s*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m);
  check(section, 'Cargo.toml must contain an explicit [package] section.');
  const field = (name) => section[1].match(new RegExp('^' + name + '\\s*=\\s*"([^"]+)"', 'm'))?.[1];
  return { name: field('name'), version: field('version') };
}

export function readReleaseMetadata(root = ROOT) {
  const pkg = readJson(join(root, 'package.json'));
  const npmLock = readJson(join(root, 'package-lock.json'));
  const config = readJson(join(root, 'src-tauri', 'tauri.conf.json'));
  const cargo = packageSection(readFileSync(join(root, 'src-tauri', 'Cargo.toml'), 'utf8'));
  const cargoLock = readFileSync(join(root, 'src-tauri', 'Cargo.lock'), 'utf8').replace(/\r\n/g, '\n');
  check(VERSION.test(pkg.version), 'Desktop releases require a stable package.json version, for example 0.3.0.');
  for (const [name, version] of [
    ['package-lock.json', npmLock.version],
    ['package-lock.json packages[""]', npmLock.packages?.['']?.version],
    ['tauri.conf.json', config.version],
    ['Cargo.toml', cargo.version],
  ]) check(version === pkg.version, name + ' version must equal package.json version ' + pkg.version + '.');
  const lockedRoot = cargoLock.split('[[package]]').some((section) =>
    section.match(/^name\s*=\s*"([^"]+)"/m)?.[1] === cargo.name &&
    section.match(/^version\s*=\s*"([^"]+)"/m)?.[1] === pkg.version);
  check(lockedRoot, 'Cargo.lock must include this app and its current version. Regenerate and commit it before releasing.');
  return {
    version: pkg.version,
    tag: 'v' + pkg.version,
    locks: {
      // Normalize Git's optional CRLF checkout on Windows before comparing platforms.
      npm: hash(readFileSync(join(root, 'package-lock.json'), 'utf8').replace(/\r\n/g, '\n')),
      cargo: hash(Buffer.from(cargoLock)),
    },
  };
}

export function assertTrigger(eventName, ref, version) {
  if (eventName === 'workflow_dispatch') {
    check(ref === 'refs/heads/main', 'Run the desktop workflow from main.');
  } else if (eventName === 'push') {
    check(ref === 'refs/tags/v' + version, 'The pushed tag must be exactly v' + version + '.');
  } else {
    throw new Error('Desktop releases support only workflow_dispatch or a version tag push.');
  }
}

function currentMetadata() {
  const metadata = readReleaseMetadata();
  metadata.sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  check(COMMIT.test(metadata.sourceSha), 'Cannot determine the checked-out source commit.');
  if (process.env.PST_RELEASE_SHA) check(metadata.sourceSha === process.env.PST_RELEASE_SHA, 'Checked-out commit differs from the prepared release.');
  if (process.env.PST_RELEASE_VERSION) check(metadata.version === process.env.PST_RELEASE_VERSION, 'Checked-out version differs from the prepared release.');
  if (process.env.GITHUB_ACTIONS === 'true') assertTrigger(process.env.GITHUB_EVENT_NAME, process.env.GITHUB_REF, metadata.version);
  return metadata;
}

function artifactNames(platform, metadata) {
  const config = PLATFORMS[platform];
  check(config, 'Unknown desktop platform: ' + platform);
  return {
    installer: 'pst_' + metadata.version + '_' + config.suffix,
    notices: 'THIRD_PARTY_RUST_' + platform + '.txt',
    manifest: platform + '.json',
    checksums: 'SHA256SUMS-' + platform + '.txt',
  };
}

function fileDetails(directory, name) {
  const path = join(directory, name);
  const stat = lstatSync(path);
  check(stat.isFile() && stat.size > 0, 'Expected a nonempty regular file: ' + name);
  return { name, size: stat.size, sha256: hash(readFileSync(path)) };
}

function checksumText(files) {
  return [...files].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).map((file) => file.sha256 + '  ' + file.name + '\n').join('');
}

function assertSourceNames(names) {
  check(Array.isArray(names) && names.length >= 2 && names.includes('README.txt') &&
    new Set(names).size === names.length &&
    names.every((name) => typeof name === 'string' && (name === 'README.txt' || CRATE_ARCHIVE.test(name))),
  'Covered-source files must include README.txt and at least one .crate archive, with safe unique filenames.');
}

function sourceArtifactName(platform, name) {
  return 'sources-' + platform + '--' + name;
}

export function collectArtifacts(root, platform, metadata) {
  check(COMMIT.test(metadata.sourceSha), 'Artifact source commit is required.');
  const names = artifactNames(platform, metadata);
  const config = PLATFORMS[platform];
  const bundleDirectory = join(root, 'src-tauri', 'target', config.target, 'release', 'bundle', config.bundle);
  const installers = readdirSync(bundleDirectory).filter((name) => name.endsWith(config.extension));
  check(installers.length === 1, 'Expected exactly one ' + config.extension + ' installer in ' + bundleDirectory + '.');
  fileDetails(bundleDirectory, installers[0]);
  const destination = join(root, 'desktop-artifacts');
  mkdirSync(destination, { recursive: true });
  copyFileSync(join(bundleDirectory, installers[0]), join(destination, names.installer));
  copyFileSync(join(root, 'src-tauri', 'THIRD_PARTY_RUST.txt'), join(destination, names.notices));
  const files = [fileDetails(destination, names.installer), fileDetails(destination, names.notices)];
  const sourceDirectory = join(root, 'src-tauri', 'THIRD_PARTY_SOURCES');
  const sources = readdirSync(sourceDirectory).sort();
  assertSourceNames(sources);
  for (const source of sources) {
    fileDetails(sourceDirectory, source);
    const artifactName = sourceArtifactName(platform, source);
    copyFileSync(join(sourceDirectory, source), join(destination, artifactName));
    files.push(fileDetails(destination, artifactName));
  }
  const manifest = { platform, target: config.target, ...metadata, sources, files };
  writeFileSync(join(destination, names.manifest), JSON.stringify(manifest, null, 2) + '\n');
  writeFileSync(join(destination, names.checksums), checksumText(files));
  return manifest;
}

export function verifyArtifacts(directory, metadata) {
  const files = [];
  const expectedNames = [];
  for (const platform of Object.keys(PLATFORMS)) {
    const names = artifactNames(platform, metadata);
    expectedNames.push(...Object.values(names));
    const manifest = readJson(join(directory, names.manifest));
    check(manifest.platform === platform && manifest.target === PLATFORMS[platform].target, 'Artifact platform mismatch: ' + platform);
    check(manifest.version === metadata.version && manifest.tag === metadata.tag && manifest.sourceSha === metadata.sourceSha, 'Artifact version or source mismatch: ' + platform);
    check(manifest.locks?.npm === metadata.locks.npm && manifest.locks?.cargo === metadata.locks.cargo, 'Artifact dependency locks mismatch: ' + platform);
    assertSourceNames(manifest.sources);
    const sourceNames = manifest.sources.map((name) => sourceArtifactName(platform, name));
    expectedNames.push(...sourceNames);
    const actualFiles = [names.installer, names.notices, ...sourceNames].map((name) => fileDetails(directory, name));
    check(Array.isArray(manifest.files) && manifest.files.length === actualFiles.length, 'Artifact file manifest is incomplete: ' + platform);
    for (const actual of actualFiles) {
      const recorded = manifest.files.find((file) => file.name === actual.name);
      check(recorded?.sha256 === actual.sha256 && recorded.size === actual.size, 'Artifact checksum mismatch: ' + actual.name);
    }
    check(readFileSync(join(directory, names.checksums), 'utf8') === checksumText(actualFiles), 'Checksum file mismatch: ' + platform);
    files.push(...actualFiles);
  }
  const actualNames = readdirSync(directory).sort();
  check(JSON.stringify(actualNames) === JSON.stringify(expectedNames.sort()), 'Unexpected or missing files in downloaded desktop artifacts.');
  return files;
}

export function assembleReleaseAssets(root, metadata) {
  const directory = join(root, 'desktop-artifacts');
  const verified = verifyArtifacts(directory, metadata);
  const files = [];
  let referenceSources;
  let referencePlatform;
  for (const platform of Object.keys(PLATFORMS)) {
    const names = artifactNames(platform, metadata);
    files.push(...verified.filter((file) => file.name === names.installer || file.name === names.notices));
    const sources = readJson(join(directory, names.manifest)).sources.sort();
    if (!referenceSources) {
      referenceSources = sources;
      referencePlatform = platform;
      continue;
    }
    check(JSON.stringify(sources) === JSON.stringify(referenceSources), 'Covered-source inventories differ between platforms.');
    for (const source of sources) {
      const reference = verified.find((file) => file.name === sourceArtifactName(referencePlatform, source));
      const current = verified.find((file) => file.name === sourceArtifactName(platform, source));
      check(current.sha256 === reference.sha256 && current.size === reference.size, 'Covered-source files differ between platforms: ' + source);
    }
  }
  // The collector emits a fixed cross-platform source superset. Publish its exact original archives once.
  for (const source of referenceSources) {
    const assetName = source === 'README.txt' ? 'THIRD_PARTY_SOURCES.txt' : source;
    copyFileSync(join(directory, sourceArtifactName(referencePlatform, source)), join(directory, assetName));
    files.push(fileDetails(directory, assetName));
  }
  for (const name of ['THIRD_PARTY_NOTICES.md', 'LICENSE-THIRD-PARTY.txt']) {
    copyFileSync(join(root, name), join(directory, name));
    files.push(fileDetails(directory, name));
  }
  writeFileSync(join(directory, 'SHA256SUMS.txt'), checksumText(files));
  files.push(fileDetails(directory, 'SHA256SUMS.txt'));
  return files;
}

function repository() {
  const repo = process.env.GH_REPO || process.env.GITHUB_REPOSITORY;
  check(repo && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo), 'GH_REPO must be an owner/repository name.');
  return repo;
}

function gh(args) {
  return execFileSync('gh', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function githubGet(endpoint, allowMissing = false) {
  const result = spawnSync('gh', ['api', '-H', 'Accept: application/vnd.github+json', endpoint], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error) throw result.error;
  if (result.status === 0) return JSON.parse(result.stdout);
  if (allowMissing && /\bHTTP 404\b/.test(result.stderr)) return null;
  throw new Error('GitHub read failed: ' + result.stderr.trim());
}

function releaseMarker(metadata) {
  return '<!-- pst-desktop-release:' + metadata.sourceSha + ' -->';
}

export function checkRemoteRelease(metadata, { repo, read, eventName }) {
  const prefix = 'repos/' + repo;
  const tagRef = read(prefix + '/git/ref/tags/' + metadata.tag, true);
  if (tagRef) {
    let object = tagRef.object;
    for (let depth = 0; object.type === 'tag' && depth < 8; depth++) {
      object = read(prefix + '/git/tags/' + object.sha).object;
    }
    check(object.type === 'commit' && object.sha === metadata.sourceSha, metadata.tag + ' already points to another commit; tags are never moved by this workflow.');
  } else {
    check(eventName !== 'push', 'The pushed release tag no longer exists.');
  }
  const release = read(prefix + '/releases/tags/' + metadata.tag, true);
  if (release) {
    check(release.draft, metadata.tag + ' is already published. Bump the app version instead of replacing published installers.');
    check(release.target_commitish === metadata.sourceSha && release.body?.includes(releaseMarker(metadata)), 'An unrelated draft already uses ' + metadata.tag + '; this workflow will not change it.');
  }
  return release;
}

function preflight(metadata) {
  return checkRemoteRelease(metadata, { repo: repository(), read: githubGet, eventName: process.env.GITHUB_EVENT_NAME });
}

function releaseNotes(metadata, repo) {
  const windows = artifactNames('windows-x64', metadata).installer;
  const mac = artifactNames('macos-universal', metadata).installer;
  return [
    releaseMarker(metadata),
    '# pst ' + metadata.version,
    '',
    '## 下載安裝程式',
    '',
    '| 系統 | 下載檔案 |',
    '| --- | --- |',
    '| Windows 10／11，x64 | ' + windows + ' |',
    '| macOS 13 以上，Apple Silicon／Intel | ' + mac + ' |',
    '',
    'Windows 使用 NSIS 使用者層級安裝程式；系統若缺少 WebView2 Runtime，安裝過程需要網路下載。macOS 開啟 DMG 後將 pst 拖入 Applications。',
    '',
    '## 簽章狀態',
    '',
    '這個版本的 Windows 安裝程式沒有發行者數位簽章。macOS 應用程式使用 ad-hoc 簽章，未經 Apple 公證，也沒有 Developer ID 發行者簽章；首次啟動可能受到作業系統的安全提示或封鎖。',
    '',
    '## 校驗與來源',
    '',
    'SHA256SUMS.txt 包含安裝程式、隨附授權說明與第三方來源封存檔的 SHA-256。Windows 可用 PowerShell 的 Get-FileHash -Algorithm SHA256；macOS 可用 shasum -a 256，比對下載檔案與校驗表。',
    '',
    '每個安裝程式已內含第三方授權說明與相關 MPL 套件來源；此頁另附對應平台的 Rust 授權文字、前端套件授權說明，以及未修改的 .crate 來源封存檔。THIRD_PARTY_SOURCES.txt 列出來源網址、校驗值與解開封存檔的方式。',
    '',
    '來源 commit：[' + metadata.sourceSha + '](https://github.com/' + repo + '/commit/' + metadata.sourceSha + ')',
    '',
    '[使用與自行建置說明](https://github.com/' + repo + '/blob/' + metadata.sourceSha + '/README.md)',
    '',
  ].join('\n');
}

function publish(metadata) {
  check(process.env.GITHUB_ACTIONS === 'true', 'Publishing is restricted to the desktop GitHub Actions workflow.');
  const directory = join(ROOT, 'desktop-artifacts');
  const files = assembleReleaseAssets(ROOT, metadata);
  const repo = repository();
  const notesFile = join(ROOT, 'desktop-release-notes.md');
  writeFileSync(notesFile, releaseNotes(metadata, repo));
  const existing = preflight(metadata);
  if (!existing) {
    gh(['release', 'create', metadata.tag, '--repo', repo, '--draft', '--target', metadata.sourceSha,
      '--title', 'pst ' + metadata.tag, '--notes-file', notesFile]);
  }
  // Clobber is restricted to a draft created for this exact commit. Published releases never reach this step.
  preflight(metadata);
  gh(['release', 'upload', metadata.tag, '--repo', repo, '--clobber', ...files.map((file) => join(directory, file.name))]);
  const draft = preflight(metadata);
  check(draft?.draft, 'The expected draft release disappeared.');
  const expectedAssets = files.map((file) => file.name).sort();
  check(JSON.stringify(draft.assets.map((asset) => asset.name).sort()) === JSON.stringify(expectedAssets), 'Draft contains unexpected or missing assets; it was not published.');
  for (const file of files) check(draft.assets.some((asset) => asset.name === file.name && asset.size === file.size && asset.state === 'uploaded'), 'GitHub asset upload is incomplete: ' + file.name);
  gh(['release', 'edit', metadata.tag, '--repo', repo, '--draft=false', '--latest', '--notes-file', notesFile]);
  const url = 'https://github.com/' + repo + '/releases/tag/' + metadata.tag;
  console.log('Published ' + url);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '## Desktop release\n\n[' + metadata.tag + '](' + url + ')\n\nWindows x64 NSIS and macOS universal DMG, with SHA-256 checksums, third-party notices, and covered source archives.\n');
}

function main() {
  const command = process.argv[2];
  const metadata = currentMetadata();
  switch (command) {
    case 'validate':
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, 'version=' + metadata.version + '\ntag=' + metadata.tag + '\nsha=' + metadata.sourceSha + '\n');
      console.log(JSON.stringify(metadata, null, 2));
      break;
    case 'preflight':
      preflight(metadata);
      console.log('Release tag and draft checks passed for ' + metadata.tag + '.');
      break;
    case 'collect':
      console.log(JSON.stringify(collectArtifacts(ROOT, process.argv[3], metadata), null, 2));
      break;
    case 'publish':
      publish(metadata);
      break;
    default:
      throw new Error('Usage: node scripts/desktop-release.mjs validate|preflight|collect <platform>|publish');
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
}
