import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assembleReleaseAssets, assertTrigger, checkRemoteRelease, collectArtifacts, readReleaseMetadata, verifyArtifacts } from './desktop-release.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pst-desktop-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src-tauri'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.3.0' }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({ version: '0.3.0', packages: { '': { version: '0.3.0' } } }, null, 2) + '\n');
  writeFileSync(join(root, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version: '0.3.0' }));
  writeFileSync(join(root, 'src-tauri', 'Cargo.toml'), '[package]\nname = "pst"\nversion = "0.3.0"\n\n[dependencies]\n');
  writeFileSync(join(root, 'src-tauri', 'Cargo.lock'), 'version = 4\n\n[[package]]\nname = "pst"\nversion = "0.3.0"\n');
  writeFileSync(join(root, 'src-tauri', 'THIRD_PARTY_RUST.txt'), 'Fixture license notice\n');
  mkdirSync(join(root, 'src-tauri', 'THIRD_PARTY_SOURCES'));
  writeFileSync(join(root, 'src-tauri', 'THIRD_PARTY_SOURCES', 'README.txt'), 'Fixture covered-source description\n');
  writeFileSync(join(root, 'src-tauri', 'THIRD_PARTY_SOURCES', 'dependency-1.2.3.crate'), 'Fixture original archive bytes');
  writeFileSync(join(root, 'THIRD_PARTY_NOTICES.md'), 'Fixture frontend notice\n');
  writeFileSync(join(root, 'LICENSE-THIRD-PARTY.txt'), 'Fixture frontend license\n');
  const metadata = { ...readReleaseMetadata(root), sourceSha: 'a'.repeat(40) };
  return { root, metadata };
}

test('requires matching npm, Cargo, lockfile, and Tauri versions before packaging', (t) => {
  const { root } = fixture(t);
  assert.equal(readReleaseMetadata(root).tag, 'v0.3.0');
  writeFileSync(join(root, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ version: '0.2.0' }));
  assert.throws(() => readReleaseMetadata(root), /tauri.conf.json version/);
});

test('rejects a stale Cargo lock even when the manifests agree', (t) => {
  const { root } = fixture(t);
  writeFileSync(join(root, 'src-tauri', 'Cargo.lock'), '[[package]]\nname = "pst"\nversion = "0.2.0"\n');
  assert.throws(() => readReleaseMetadata(root), /Cargo.lock must include/);
});

test('lockfile identities survive Windows CRLF checkout', (t) => {
  const { root, metadata } = fixture(t);
  for (const file of ['package-lock.json', 'src-tauri/Cargo.lock']) {
    const path = join(root, file);
    writeFileSync(path, readFileSync(path, 'utf8').replace(/\n/g, '\r\n'));
  }
  assert.deepEqual(readReleaseMetadata(root).locks, metadata.locks);
});

test('manual releases are main-only and tag releases match the app version', () => {
  assert.doesNotThrow(() => assertTrigger('workflow_dispatch', 'refs/heads/main', '0.3.0'));
  assert.doesNotThrow(() => assertTrigger('push', 'refs/tags/v0.3.0', '0.3.0'));
  assert.throws(() => assertTrigger('workflow_dispatch', 'refs/heads/feature', '0.3.0'), /from main/);
  assert.throws(() => assertTrigger('push', 'refs/tags/v0.4.0', '0.3.0'), /exactly v0.3.0/);
  assert.throws(() => assertTrigger('pull_request', 'refs/pull/1/merge', '0.3.0'), /support only/);
});

function packageBoth(root, metadata, afterWindows) {
  for (const [platform, target, bundle, filename] of [
    ['windows-x64', 'x86_64-pc-windows-msvc', 'nsis', 'pst_0.3.0_x64-setup.exe'],
    ['macos-universal', 'universal-apple-darwin', 'dmg', 'pst_0.3.0_universal.dmg'],
  ]) {
    const directory = join(root, 'src-tauri', 'target', target, 'release', 'bundle', bundle);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, filename), 'Fixture installer for ' + platform);
    collectArtifacts(root, platform, metadata);
    if (platform === 'windows-x64') afterWindows?.();
  }
  return join(root, 'desktop-artifacts');
}

test('accepts a complete two-platform set and rejects installer tampering', (t) => {
  const { root, metadata } = fixture(t);
  const directory = packageBoth(root, metadata);
  assert.equal(verifyArtifacts(directory, metadata).length, 8);
  writeFileSync(join(directory, 'pst_0.3.0_windows-x64-setup.exe'), 'Changed installer');
  assert.throws(() => verifyArtifacts(directory, metadata), /checksum mismatch/);
});

test('rejects artifacts from another commit and extra unreviewed release files', (t) => {
  const { root, metadata } = fixture(t);
  const directory = packageBoth(root, metadata);
  assert.throws(() => verifyArtifacts(directory, { ...metadata, sourceSha: 'b'.repeat(40) }), /source mismatch/);
  writeFileSync(join(directory, 'extra.exe'), 'Unexpected installer');
  assert.throws(() => verifyArtifacts(directory, metadata), /Unexpected or missing/);
});

test('rejects modified platform notices before publication', (t) => {
  const { root, metadata } = fixture(t);
  const directory = packageBoth(root, metadata);
  const notice = join(directory, 'THIRD_PARTY_RUST_macos-universal.txt');
  writeFileSync(notice, readFileSync(notice, 'utf8') + 'Changed license notice\n');
  assert.throws(() => verifyArtifacts(directory, metadata), /checksum mismatch/);
});

test('publishes identical covered sources once and includes them in the combined checksums', (t) => {
  const { root, metadata } = fixture(t);
  const directory = packageBoth(root, metadata);
  const assets = assembleReleaseAssets(root, metadata);
  assert.equal(assets.length, 9);
  assert.equal(assets.filter((file) => file.name === 'dependency-1.2.3.crate').length, 1);
  assert.equal(readFileSync(join(directory, 'THIRD_PARTY_SOURCES.txt'), 'utf8'), 'Fixture covered-source description\n');
  const checksums = readFileSync(join(directory, 'SHA256SUMS.txt'), 'utf8');
  assert.match(checksums, /^[a-f0-9]{64}  dependency-1\.2\.3\.crate$/m);
  assert.match(checksums, /^[a-f0-9]{64}  THIRD_PARTY_SOURCES\.txt$/m);
  assert.equal(checksums.trim().split('\n').length, 8);
});

test('rejects modified or missing covered-source files', (t) => {
  const { root, metadata } = fixture(t);
  const directory = packageBoth(root, metadata);
  const archive = join(directory, 'sources-windows-x64--dependency-1.2.3.crate');
  writeFileSync(archive, 'Modified source archive');
  assert.throws(() => verifyArtifacts(directory, metadata), /checksum mismatch/);
  unlinkSync(archive);
  assert.throws(() => verifyArtifacts(directory, metadata), /ENOENT/);
});

test('rejects two individually valid platform artifacts with conflicting covered sources', (t) => {
  const { root, metadata } = fixture(t);
  const directory = packageBoth(root, metadata, () => {
    writeFileSync(join(root, 'src-tauri', 'THIRD_PARTY_SOURCES', 'dependency-1.2.3.crate'), 'Different archive in second platform');
  });
  assert.equal(verifyArtifacts(directory, metadata).length, 8);
  assert.throws(() => assembleReleaseAssets(root, metadata), /Covered-source files differ/);
});

test('rejects unsafe source filenames before reading a downloaded artifact', (t) => {
  const { root, metadata } = fixture(t);
  const directory = packageBoth(root, metadata);
  const path = join(directory, 'windows-x64.json');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  manifest.sources.push('../outside.crate');
  writeFileSync(path, JSON.stringify(manifest));
  assert.throws(() => verifyArtifacts(directory, metadata), /safe unique filenames/);
});

function remoteOptions(metadata, { tagSha = metadata.sourceSha, release = null, annotated = false, eventName = 'workflow_dispatch' } = {}) {
  return {
    repo: 'owner/pst', eventName,
    read(endpoint) {
      if (endpoint.includes('/git/ref/tags/')) return tagSha ? { object: { type: annotated ? 'tag' : 'commit', sha: tagSha } } : null;
      if (endpoint.includes('/git/tags/')) return { object: { type: 'commit', sha: metadata.sourceSha } };
      if (endpoint.includes('/releases/tags/')) return release;
      throw new Error('Unexpected mock read: ' + endpoint);
    },
  };
}

test('validates lightweight and annotated tag commits; never moves a conflicting tag', (t) => {
  const { metadata } = fixture(t);
  assert.equal(checkRemoteRelease(metadata, remoteOptions(metadata)), null);
  assert.equal(checkRemoteRelease(metadata, remoteOptions(metadata, { annotated: true })), null);
  assert.equal(checkRemoteRelease(metadata, remoteOptions(metadata, { tagSha: null })), null);
  assert.throws(() => checkRemoteRelease(metadata, remoteOptions(metadata, { tagSha: 'b'.repeat(40) })), /another commit/);
  assert.throws(() => checkRemoteRelease(metadata, remoteOptions(metadata, { tagSha: null, eventName: 'push' })), /no longer exists/);
});

test('refuses published releases and unrelated drafts, while allowing a same-commit draft retry', (t) => {
  const { metadata } = fixture(t);
  const ownDraft = { draft: true, target_commitish: metadata.sourceSha, body: '<!-- pst-desktop-release:' + metadata.sourceSha + ' -->' };
  assert.equal(checkRemoteRelease(metadata, remoteOptions(metadata, { release: ownDraft })), ownDraft);
  assert.throws(() => checkRemoteRelease(metadata, remoteOptions(metadata, { release: { ...ownDraft, draft: false } })), /already published/);
  assert.throws(() => checkRemoteRelease(metadata, remoteOptions(metadata, { release: { ...ownDraft, body: 'A manually created draft' } })), /unrelated draft/);
  assert.throws(() => checkRemoteRelease(metadata, remoteOptions(metadata, { release: { ...ownDraft, target_commitish: 'b'.repeat(40) } })), /unrelated draft/);
});
