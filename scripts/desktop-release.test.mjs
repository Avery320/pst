import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { assembleReleaseAssets, assertTrigger, checkRemoteRelease, collectArtifacts, readReleaseMetadata, verifyArtifacts, verifyRemoteReleaseAssets } from './desktop-release.mjs';

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

function ownDraft(metadata) {
  return { id: 418267755, tag_name: metadata.tag, draft: true, target_commitish: metadata.sourceSha, body: '<!-- pst-desktop-release:' + metadata.sourceSha + ' -->' };
}

function remoteOptions(metadata, { tagSha = metadata.sourceSha, release = null, pages = [], byId = release, annotated = false, eventName = 'workflow_dispatch' } = {}) {
  const calls = [];
  return {
    repo: 'owner/pst', eventName, calls,
    read(endpoint) {
      calls.push(endpoint);
      if (endpoint.includes('/git/ref/tags/')) return tagSha ? { object: { type: annotated ? 'tag' : 'commit', sha: tagSha } } : null;
      if (endpoint.includes('/git/tags/')) return { object: { type: 'commit', sha: metadata.sourceSha } };
      if (endpoint.includes('/releases/tags/')) return release;
      const page = endpoint.match(/\/releases\?per_page=100&page=(\d+)$/);
      if (page) return pages[Number(page[1]) - 1] ?? [];
      if (/\/releases\/\d+$/.test(endpoint)) return byId;
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
  const draft = ownDraft(metadata);
  assert.equal(checkRemoteRelease(metadata, remoteOptions(metadata, { release: draft })), draft);
  assert.throws(() => checkRemoteRelease(metadata, remoteOptions(metadata, { release: { ...draft, draft: false } })), /already published/);
  assert.throws(() => checkRemoteRelease(metadata, remoteOptions(metadata, { release: { ...draft, body: 'A manually created draft' } })), /unrelated draft/);
  assert.throws(() => checkRemoteRelease(metadata, remoteOptions(metadata, { release: { ...draft, target_commitish: 'b'.repeat(40) } })), /unrelated draft/);
});

test('finds a draft by exact tag on a later collection page when the tag endpoint returns 404', (t) => {
  const { metadata } = fixture(t);
  const draft = ownDraft(metadata);
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ ...draft, id: index + 1, tag_name: metadata.tag + '-old.' + index }));
  const options = remoteOptions(metadata, { pages: [firstPage, [draft]] });
  assert.equal(checkRemoteRelease(metadata, options), draft);
  assert.deepEqual(options.calls.filter((endpoint) => endpoint.includes('/releases')), [
    'repos/owner/pst/releases/tags/v0.3.0',
    'repos/owner/pst/releases?per_page=100&page=1',
    'repos/owner/pst/releases?per_page=100&page=2',
  ]);
});

test('collection fallback still refuses published, unrelated, and duplicate exact-tag releases', (t) => {
  const { metadata } = fixture(t);
  const draft = ownDraft(metadata);
  assert.throws(() => checkRemoteRelease(metadata, remoteOptions(metadata, { pages: [[{ ...draft, draft: false }]] })), /already published/);
  assert.throws(() => checkRemoteRelease(metadata, remoteOptions(metadata, { pages: [[{ ...draft, target_commitish: 'b'.repeat(40) }]] })), /unrelated draft/);
  assert.throws(() => checkRemoteRelease(metadata, remoteOptions(metadata, { pages: [[{ ...draft, body: 'Other release' }]] })), /unrelated draft/);
  const firstPage = Array.from({ length: 100 }, (_, index) => index === 0 ? draft : { ...draft, id: index, tag_name: 'v9.0.' + index });
  assert.throws(() => checkRemoteRelease(metadata, remoteOptions(metadata, { pages: [firstPage, [{ ...draft, id: draft.id + 1 }]] })), /Multiple releases/);
});

test('collection lookup fails closed on an invalid response or a non-404 API error', (t) => {
  const { metadata } = fixture(t);
  assert.throws(() => checkRemoteRelease(metadata, remoteOptions(metadata, { pages: [{ message: 'API failure' }] })), /invalid release collection/);
  const options = remoteOptions(metadata);
  const read = options.read;
  options.read = (endpoint) => {
    if (endpoint.includes('/releases?')) throw new Error('HTTP 403: forbidden');
    return read(endpoint);
  };
  assert.throws(() => checkRemoteRelease(metadata, options), /HTTP 403/);
});

test('checks a discovered draft by its fixed ID without depending on tag or collection lookup', (t) => {
  const { metadata } = fixture(t);
  const draft = ownDraft(metadata);
  const options = remoteOptions(metadata, { byId: draft });
  assert.equal(checkRemoteRelease(metadata, { ...options, releaseId: draft.id }), draft);
  assert.deepEqual(options.calls.filter((endpoint) => endpoint.includes('/releases')), ['repos/owner/pst/releases/' + draft.id]);
});

test('a pinned draft cannot disappear, change identity or source, or become published before another write', (t) => {
  const { metadata } = fixture(t);
  const draft = ownDraft(metadata);
  for (const [byId, expected] of [
    [null, /disappeared/],
    [{ ...draft, id: draft.id + 1 }, /ID changed/],
    [{ ...draft, tag_name: 'v0.4.0' }, /unexpected release ID or tag/],
    [{ ...draft, draft: false }, /already published/],
    [{ ...draft, target_commitish: 'b'.repeat(40) }, /unrelated draft/],
    [{ ...draft, body: 'A different draft' }, /unrelated draft/],
  ]) {
    // Even if the collection now has a replacement, the original ID remains authoritative.
    const options = remoteOptions(metadata, { byId, pages: [[{ ...draft, id: draft.id + 1 }]] });
    assert.throws(() => checkRemoteRelease(metadata, { ...options, releaseId: draft.id }), expected);
    assert.equal(options.calls.some((endpoint) => endpoint.includes('/releases?')), false);
  }
});

test('requires all 13 uploaded assets with exact sizes and server SHA-256 digests before publishing', (t) => {
  const { root, metadata } = fixture(t);
  for (let index = 2; index <= 5; index++) {
    writeFileSync(join(root, 'src-tauri', 'THIRD_PARTY_SOURCES', 'dependency-' + index + '.0.0.crate'), 'Source archive ' + index);
  }
  packageBoth(root, metadata);
  const files = assembleReleaseAssets(root, metadata);
  assert.equal(files.length, 13);
  const assets = files.map((file) => ({ name: file.name, size: file.size, state: 'uploaded', digest: 'sha256:' + file.sha256 })).reverse();
  const draft = { ...ownDraft(metadata), assets };
  assert.doesNotThrow(() => verifyRemoteReleaseAssets(draft, files));
  assert.throws(() => verifyRemoteReleaseAssets({ ...draft, assets: assets.slice(1) }, files), /missing assets/);
  assert.throws(() => verifyRemoteReleaseAssets({ ...draft, assets: [...assets, { ...assets[0], name: 'unexpected.exe' }] }, files), /unexpected or missing assets/);
  for (const [change, expected] of [
    [{ size: assets[0].size + 1 }, /upload is incomplete/],
    [{ state: 'starter' }, /upload is incomplete/],
    [{ digest: null }, /checksum mismatch/],
    [{ digest: 'sha256:' + '0'.repeat(64) }, /checksum mismatch/],
  ]) {
    assert.throws(() => verifyRemoteReleaseAssets({ ...draft, assets: [{ ...assets[0], ...change }, ...assets.slice(1)] }, files), expected);
  }
});
