import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  collectNoticeFiles, createNoticeDocument, loadUpstreamLicenses, lockedArchiveChecksums,
  mergePackageGraphs, prepareSourceArchives, resolvedPackages,
} from './desktop-licenses.mjs';

function graphFixture() {
  const packages = ['app', 'normal', 'build', 'shared', 'dev', 'unused'].map(id => ({ id, name: id, version: '1.0.0' }));
  const edge = (pkg, kind = null) => ({ pkg, dep_kinds: [{ kind, target: null }] });
  const nodes = [
    { id: 'app', deps: [edge('normal'), edge('build', 'build'), edge('dev', 'dev')], features: [] },
    { id: 'normal', deps: [edge('shared')], features: ['std'] },
    { id: 'build', deps: [edge('shared')], features: [] },
    ...['shared', 'dev', 'unused'].map(id => ({ id, deps: [], features: [] })),
  ];
  return { packages, workspace_members: ['app'], resolve: { root: 'app', nodes } };
}

test('notice inventory follows reachable normal/build edges, not every metadata package or dev edge', () => {
  const graph = resolvedPackages(graphFixture(), 'target-a');
  assert.deepEqual([...graph.keys()].sort(), ['build', 'normal', 'shared']);
  assert.deepEqual([...graph.get('normal').features], ['std']);
});

test('universal target merge retains per-target packages and feature unions', () => {
  const first = resolvedPackages(graphFixture(), 'aarch64-apple-darwin');
  const secondMetadata = graphFixture();
  secondMetadata.resolve.nodes.find(node => node.id === 'normal').features.push('intel-feature');
  secondMetadata.resolve.nodes.find(node => node.id === 'app').deps.push({ pkg: 'unused', dep_kinds: [{ kind: null }] });
  const second = resolvedPackages(secondMetadata, 'x86_64-apple-darwin');
  const merged = mergePackageGraphs([first, second]);
  assert.deepEqual([...merged.get('normal').features].sort(), ['intel-feature', 'std']);
  assert.equal(merged.get('normal').targets.size, 2);
  assert.deepEqual([...merged.get('unused').targets], ['x86_64-apple-darwin']);
  assert.deepEqual([...first.get('normal').features], ['std']);
});

function crate(root, name, files) {
  const directory = join(root, name);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'Cargo.toml'), '');
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(directory, relative);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, contents);
  }
  return { id: name, name, version: '1.0.0', license: 'MIT', license_file: null,
    manifest_path: join(directory, 'Cargo.toml'), source: 'registry+test', authors: [`${name} contributor`] };
}

test('exact-byte deduplication preserves each origin and nested third-party notices', t => {
  const root = mkdtempSync(join(tmpdir(), 'pst-license-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const exact = '\uFEFFMIT License\r\nCopyright example contributors.\r\n';
  const first = crate(root, 'first', { LICENSE: exact, 'vendor/component/NOTICE.txt': 'Nested attribution\n' });
  const second = crate(root, 'second', { 'LICENSE-MIT': exact });
  const graph = new Map([first, second].map(pkg => [pkg.id,
    { pkg, targets: new Set(['target-b', 'target-a']), features: new Set() }]));
  const options = { targets: ['target-b', 'target-a'], lockHash: 'test-hash' };
  const text = createNoticeDocument(graph, options);
  assert.ok(text.includes(exact));
  assert.equal(text.split(exact).length - 1, 1);
  assert.match(text, /first 1\.0\.0 — LICENSE/);
  assert.match(text, /second 1\.0\.0 — LICENSE-MIT/);
  assert.match(text, /vendor\/component\/NOTICE\.txt/);
  assert.match(text, /Authors: first contributor/);
  assert.ok(text.includes(createHash('sha256').update(exact).digest('hex')));
  const reverse = createNoticeDocument(new Map([...graph].reverse()), { ...options, targets: [...options.targets].reverse() });
  assert.equal(reverse, text);
});

test('a nested third-party license or a NOTICE cannot hide a missing crate license', t => {
  const root = mkdtempSync(join(tmpdir(), 'pst-license-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = crate(root, 'missing', { NOTICE: 'Attribution only', 'vendor/library/LICENSE': 'Third-party license' });
  const graph = new Map([[pkg.id, { pkg, targets: new Set(['target']), features: new Set() }]]);
  assert.throws(() => createNoticeDocument(graph, { targets: ['target'], lockHash: 'hash' }), /missing 1\.0\.0 .*no non-empty LICENSE/);
});

test('declared nonstandard license_file is copied and missing declared files fail explicitly', t => {
  const root = mkdtempSync(join(tmpdir(), 'pst-license-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = crate(root, 'custom', { 'legal/terms.txt': 'Exact custom terms\n' });
  pkg.license_file = 'legal/terms.txt';
  const files = collectNoticeFiles(pkg);
  assert.equal(files[0].text, 'Exact custom terms\n');
  assert.equal(files[0].isLicense, true);
  pkg.license_file = 'missing-license.txt';
  assert.throws(() => collectNoticeFiles(pkg), /ENOENT/);
});

test('non-UTF-8 license text fails rather than silently changing its bytes', t => {
  const root = mkdtempSync(join(tmpdir(), 'pst-license-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = crate(root, 'encoding', { LICENSE: Buffer.from([0xff, 0xfe, 0x41]) });
  assert.throws(() => collectNoticeFiles(pkg), /not UTF-8/);
});

test('upstream supplements require exact text hashes and the reviewed crate commit', t => {
  const root = mkdtempSync(join(tmpdir(), 'pst-license-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = crate(root, 'supplemented', { '.cargo_vcs_info.json': JSON.stringify({ git: { sha1: 'reviewed-commit' } }) });
  pkg.repository = 'https://github.com/example/project';
  const text = 'Original upstream license\r\n';
  const digest = createHash('sha256').update(text).digest('hex');
  const url = 'https://raw.githubusercontent.com/example/project/reviewed-commit/LICENSE';
  const data = { schemaVersion: 1, documents: { [digest]: { sha256: digest, text, origins: [{ url }] } },
    packages: { 'supplemented@1.0.0': { gitCommit: 'reviewed-commit', repository: pkg.repository,
      declaredLicense: 'MIT', files: [{ document: digest, url, upstreamPath: 'LICENSE', role: 'license' }] } }, sourceArchives: [] };
  const path = join(root, 'upstream.json');
  writeFileSync(path, JSON.stringify(data));
  const upstream = loadUpstreamLicenses(path);
  const files = collectNoticeFiles(pkg, upstream);
  assert.equal(files[0].text, text);
  assert.equal(files[0].isLicense, true);
  writeFileSync(join(root, 'supplemented/.cargo_vcs_info.json'), JSON.stringify({ git: { sha1: 'other-commit' } }));
  assert.throws(() => collectNoticeFiles(pkg, upstream), /does not match its reviewed upstream supplement/);
  data.documents[digest].text += 'modified';
  writeFileSync(path, JSON.stringify(data));
  assert.throws(() => loadUpstreamLicenses(path), /failed its exact-text SHA-256 check/);
});

test('MPL archives match Cargo.lock and reviewed bytes, with a stable platform-independent source notice', t => {
  const root = mkdtempSync(join(tmpdir(), 'pst-license-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const pkg = crate(join(root, 'registry/src/example-index'), 'covered', { LICENSE: 'MPL terms' });
  pkg.license = 'MPL-2.0';
  const bytes = Buffer.from([31, 139, 8, 0, 0, 255, 1, 7]);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const archive = join(root, 'registry/cache/example-index/covered-1.0.0.crate');
  mkdirSync(join(archive, '..'), { recursive: true });
  writeFileSync(archive, bytes);
  const upstream = { sourceArchives: [{ name: pkg.name, version: pkg.version, license: pkg.license,
    source: pkg.source, sha256: digest, url: 'https://crates.io/api/v1/crates/covered/1.0.0/download', repository: 'upstream' }],
  documents: { reference: { text: 'Complete reviewed MPL text', origins: [{ path: 'text/MPL-2.0.txt' }] } } };
  const lock = `version = 4\n\n[[package]]\nname = "covered"\nversion = "1.0.0"\nsource = "registry+test"\nchecksum = "${digest}"\n`;
  assert.equal(lockedArchiveChecksums(lock.replaceAll('\n', '\r\n')).get('covered@1.0.0 registry+test'), digest);
  const all = new Map([[pkg.id, pkg]]);
  const graph = new Map([[pkg.id, { pkg, targets: new Set(['windows']) }]]);
  const files = prepareSourceArchives(all, graph, upstream, lock);
  assert.deepEqual(files.get('covered-1.0.0.crate'), bytes);
  assert.ok(!files.get('README.txt').toString().includes(root));
  graph.get(pkg.id).targets = new Set(['macos']);
  const macFiles = prepareSourceArchives(all, graph, upstream, lock.replaceAll('\n', '\r\n'));
  assert.deepEqual(macFiles.get('README.txt'), files.get('README.txt'));
  assert.throws(() => prepareSourceArchives(all, graph, upstream, lock.replace(digest, '0'.repeat(64))), /checksum mismatch/);
  writeFileSync(archive, Buffer.from('changed archive'));
  assert.throws(() => prepareSourceArchives(all, graph, upstream, lock), /checksum mismatch/);
});

test('new MPL dependencies require an explicit source inventory update', () => {
  const pkg = { name: 'new-covered-code', version: '2.0.0', license: 'MPL-2.0' };
  const graph = new Map([['new', { pkg }]]);
  assert.throws(() => prepareSourceArchives(new Map(), graph, { sourceArchives: [] }, ''), /MPL source is not in the reviewed source-archive inventory/);
});
