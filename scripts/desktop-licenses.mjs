#!/usr/bin/env node
// Uses Cargo's locked, target-filtered graph; no network lookup or guessed
// replacement license text is performed by this collector.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIVIDER = '='.repeat(78);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const slash = value => value.split(sep).join('/');
const noticeName = /^(?:licen[cs]e(?:s)?|unlicen[cs]e|copying|copyright|notice(?:s)?|authors?)(?:$|[._-])/i;
const licenseName = /^(?:licen[cs]e(?:s)?|unlicen[cs]e|copying)(?:$|[._-])/i;
const legalDirectory = /^(?:licen[cs]es?|notices?|copyrights?)$/i;
const standaloneLicense = /^(?:mit|apache(?:[-_.]2(?:[-_.]0)?)?|bsd(?:[-_.][23][-_]clause)?|isc|zlib|unlicense)(?:\.(?:txt|md|rst))?$/i;
const excludedExtension = /\.(?:rs|c|cc|cpp|h|hpp|js|ts|json|toml|lock|png|jpg|gif|ico|pdf|woff2?|ttf|bin|exe|dll)$/i;
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

export function loadUpstreamLicenses(path = resolve(PROJECT_ROOT, 'licenses/desktop/upstream-licenses.json')) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  if (data.schemaVersion !== 1 || !data.documents || !data.packages || !Array.isArray(data.sourceArchives)) {
    throw new Error('Unsupported desktop upstream-license inventory format.');
  }
  for (const [id, document] of Object.entries(data.documents)) {
    if (typeof document.text !== 'string' || id !== document.sha256 || sha256(Buffer.from(document.text)) !== id) {
      throw new Error(`Stored upstream license ${id} failed its exact-text SHA-256 check.`);
    }
  }
  return data;
}

/** Metadata's packages array is an inventory, not the target's reachable graph. */
export function resolvedPackages(metadata, target) {
  if (!metadata.resolve || !Array.isArray(metadata.resolve.nodes) || !Array.isArray(metadata.packages)) {
    throw new Error(`Cargo metadata for ${target} has no resolved dependency graph.`);
  }
  const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]));
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]));
  const workspace = new Set(metadata.workspace_members ?? []);
  const roots = metadata.resolve.root ? [metadata.resolve.root]
    : metadata.workspace_default_members ?? metadata.workspace_members ?? [];
  if (!roots.length) throw new Error(`Cargo metadata for ${target} has no application root.`);
  const pending = [...roots];
  const visited = new Set();
  const result = new Map();
  while (pending.length) {
    const id = pending.pop();
    if (visited.has(id)) continue;
    visited.add(id);
    const pkg = packages.get(id);
    const node = nodes.get(id);
    if (!pkg || !node || !Array.isArray(node.deps)) {
      throw new Error(`Incomplete resolved metadata for ${id} (${target}).`);
    }
    if (!workspace.has(id)) {
      result.set(id, { pkg, targets: new Set([target]), features: new Set(node.features ?? []) });
    }
    for (const dependency of node.deps) {
      if (!Array.isArray(dependency.dep_kinds)) {
        throw new Error(`Cargo metadata lacks dependency-kind information for ${id} -> ${dependency.pkg}.`);
      }
      if (dependency.dep_kinds.some(kind => kind.kind === null || kind.kind === 'normal' || kind.kind === 'build')) {
        pending.push(dependency.pkg);
      }
    }
  }
  return result;
}

export function mergePackageGraphs(graphs) {
  const merged = new Map();
  for (const graph of graphs) {
    for (const [id, item] of graph) {
      const previous = merged.get(id);
      if (!previous) merged.set(id, { pkg: item.pkg, targets: new Set(item.targets), features: new Set(item.features) });
      else {
        for (const target of item.targets) previous.targets.add(target);
        for (const feature of item.features) previous.features.add(feature);
      }
    }
  }
  return merged;
}

/** Preserve all discovered legal files, including notices for bundled subtrees. */
export function collectNoticeFiles(pkg, upstream) {
  const root = realpathSync(dirname(pkg.manifest_path));
  const paths = new Map();
  function visit(directory, insideLegalDirectory = false) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => compare(a.name, b.name))) {
      if (entry.name === '.git' || entry.name === 'target' || entry.name === 'node_modules') continue;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) visit(path, insideLegalDirectory || legalDirectory.test(entry.name));
      else if (entry.isFile() && !excludedExtension.test(entry.name)
        && (insideLegalDirectory || noticeName.test(entry.name) || standaloneLicense.test(entry.name))) {
        const components = relative(root, path).split(sep);
        // A vendored library's nested license is retained, but cannot stand in
        // for a missing license for the enclosing crate itself.
        paths.set(path, { license: directory === root && (licenseName.test(entry.name) || standaloneLicense.test(entry.name))
          || /^(?:licen[cs]es?)$/i.test(components[0]) && !/^(?:notice|copyright|authors?|readme)/i.test(entry.name) });
      }
    }
  }
  visit(root);
  if (pkg.license_file) {
    const path = realpathSync(resolve(root, pkg.license_file));
    const local = relative(root, path);
    if (local.startsWith(`..${sep}`) || local === '..' || isAbsolute(local)) {
      throw new Error(`${pkg.name} ${pkg.version}: declared license_file is outside its crate source directory.`);
    }
    paths.set(path, { license: true });
  }
  const files = [...paths.entries()].map(([path, flags]) => {
    const bytes = readFileSync(path);
    let text;
    try { text = decoder.decode(bytes); }
    catch { throw new Error(`${pkg.name} ${pkg.version}: ${slash(relative(root, path))} is not UTF-8 text; preserve and review it explicitly.`); }
    return { path: slash(relative(root, path)), hash: sha256(bytes), text, isLicense: flags.license && text.trim().length > 0 };
  });
  const supplement = upstream?.packages[`${pkg.name}@${pkg.version}`];
  if (supplement) {
    const vcs = JSON.parse(readFileSync(resolve(root, '.cargo_vcs_info.json'), 'utf8'));
    if (vcs.git?.sha1 !== supplement.gitCommit || pkg.repository !== supplement.repository
      || pkg.license !== supplement.declaredLicense) {
      throw new Error(`${pkg.name} ${pkg.version}: source commit, repository or declared license does not match its reviewed upstream supplement.`);
    }
    for (const reference of supplement.files) {
      const document = upstream.documents[reference.document];
      if (!document || !document.origins.some(origin => origin.url === reference.url)) {
        throw new Error(`${pkg.name} ${pkg.version}: missing provenance for upstream supplement ${reference.document}.`);
      }
      files.push({ path: `upstream/${reference.upstreamPath}`, hash: document.sha256, text: document.text,
        provenance: `${reference.role}: ${reference.url}`,
        isLicense: reference.role === 'license' || reference.role === 'reference-license' });
    }
  }
  return files.sort((a, b) => compare(a.path, b.path) || compare(a.hash, b.hash));
}

export function createNoticeDocument(graph, { targets, lockHash, features = [], upstream }) {
  const items = [...graph.values()].sort((a, b) => compare(a.pkg.name, b.pkg.name)
    || compare(a.pkg.version, b.pkg.version) || compare(a.pkg.id, b.pkg.id));
  const problems = [];
  const groups = new Map();
  const scanned = [];
  for (const item of items) {
    const { pkg } = item;
    if (!pkg.license && !pkg.license_file) problems.push(`${pkg.name} ${pkg.version}: no license declaration or license_file in Cargo metadata.`);
    let files;
    try { files = collectNoticeFiles(pkg, upstream); }
    catch (error) { problems.push(error.message); continue; }
    if (!files.some(file => file.isLicense)) {
      problems.push(`${pkg.name} ${pkg.version} (${pkg.license ?? 'undeclared'}): no non-empty LICENSE/COPYING or declared license_file was found.`);
    }
    for (const file of files) {
      const attribution = `${pkg.name} ${pkg.version} — ${file.path}${file.provenance ? ` — ${file.provenance}` : ''}`;
      const previous = groups.get(file.hash);
      if (previous) previous.origins.push(attribution);
      else groups.set(file.hash, { hash: file.hash, text: file.text, origins: [attribution] });
    }
    scanned.push({ ...item, files });
  }
  if (problems.length) {
    throw new Error(`Desktop notice generation is incomplete; no new notice file was written.\n${problems.map(p => `- ${p}`).join('\n')}\nObtain the exact missing notices from the relevant official upstream source before distributing this build.`);
  }
  const sortedGroups = [...groups.values()].sort((a, b) => compare(a.hash, b.hash));
  const labels = new Map(sortedGroups.map((group, index) => [group.hash, `N${String(index + 1).padStart(4, '0')}`]));
  const lines = [
    'pst — RUST DEPENDENCY LICENSES AND NOTICES', '',
    `Requested targets: ${[...new Set(targets)].sort(compare).join(', ')}`,
    `Cargo.lock SHA-256: ${lockHash}`,
    `Explicit Cargo features: ${[...new Set(features)].sort(compare).join(', ') || '(Cargo defaults)'}`,
    `Crates in resolved dependency closure: ${scanned.length}`,
    `License/notice files: ${scanned.reduce((count, item) => count + item.files.length, 0)}`,
    `Distinct exact file contents: ${sortedGroups.length}`, '',
    'Generated by scripts/desktop-licenses.mjs from cargo metadata --locked,',
    'filtered for each requested target. Normal and build dependency edges are',
    'included; purely development-only edges and pst workspace packages are excluded.',
    'Build dependencies and bundled-source notices are conservatively included.',
    'This inventory does not assert that every listed crate is linked into the app.', '',
    'License expressions and authors below are the crates\' reported metadata.',
    'Exact available license/notice texts follow; identical bytes are deduplicated',
    'with every originating crate/file attribution retained. No license is assigned',
    'to pst\'s own code, and no legal conclusion is inferred from SPDX metadata alone.',
    'This file is not a complete historical audit of inline source attributions.', '',
    'Where a crate archive omits its upstream license, reviewed supplements from',
    'licenses/desktop/upstream-licenses.json identify the exact source commit and',
    'URL. Canonical reference terms are distinguished from upstream declarations;',
    'no copyright holder or year is invented to fill a template.', '',
    'Unmodified source archives for the selected MPL-2.0 components are supplied',
    'in the companion THIRD_PARTY_SOURCES directory and as release assets.',
    'Its README.txt identifies every source archive and includes the MPL terms.', '',
    DIVIDER, 'CRATE INVENTORY', DIVIDER, '',
  ];
  for (const { pkg, targets: usedTargets, features: usedFeatures, files } of scanned) {
    const supplement = upstream?.packages[`${pkg.name}@${pkg.version}`];
    lines.push(`${pkg.name} ${pkg.version}`,
      `Declared license: ${pkg.license || `license-file (${pkg.license_file})`}`,
      `Source: ${pkg.source || '(local dependency)'}`,
      `Repository: ${pkg.repository || '(not declared)'}`,
      `Authors: ${(pkg.authors ?? []).join('; ') || '(not declared)'}`,
      `Targets: ${[...usedTargets].sort(compare).join(', ')}`,
      `Enabled features: ${[...usedFeatures].sort(compare).join(', ') || '(none)'}`,
      ...(supplement?.licenseChoice ? [`Selected offered license: ${supplement.licenseChoice}`] : []),
      ...(supplement?.explanation ? [`Upstream supplement: ${supplement.explanation}`] : []),
      ...files.map(file => `Notice: ${labels.get(file.hash)} — ${file.path} — SHA-256 ${file.hash}`), '');
  }
  let output = `${lines.join('\n')}\n`;
  for (const group of sortedGroups) {
    output += [DIVIDER, `${labels.get(group.hash)} — SHA-256 ${group.hash}`, 'Copied from:',
      ...group.origins.sort(compare).map(origin => `- ${origin}`), DIVIDER, '', ''].join('\n');
    // Keep the original text (including BOM or CRLF) exactly; add a separator
    // newline outside it only when the upstream file lacks its final newline.
    output += group.text + (group.text.endsWith('\n') ? '' : '\n') + '\n';
  }
  return output;
}

/** Read the simple registry identity/checksum fields in Cargo's generated lock. */
export function lockedArchiveChecksums(lockText) {
  const checksums = new Map();
  for (const block of lockText.split(/^\[\[package\]\]\s*$/m).slice(1)) {
    const field = name => block.match(new RegExp(`^${name}\\s*=\\s*"([^"\\r\\n]+)"\\s*$`, 'm'))?.[1];
    const name = field('name'), version = field('version'), source = field('source'), checksum = field('checksum');
    if (name && version && source && checksum) {
      if (!/^[a-f0-9]{64}$/.test(checksum)) throw new Error(`Invalid Cargo.lock archive checksum for ${name} ${version}.`);
      checksums.set(`${name}@${version} ${source}`, checksum);
    }
  }
  return checksums;
}

/** Keep the small reviewed MPL source set identical in both platform releases. */
export function prepareSourceArchives(allPackages, graph, upstream, lockText) {
  const lockChecksums = lockedArchiveChecksums(lockText);
  const configured = new Set(upstream.sourceArchives.map(item => `${item.name}@${item.version}`));
  for (const { pkg } of graph.values()) {
    if (/\bMPL-2\.0\b/.test(pkg.license ?? '') && !configured.has(`${pkg.name}@${pkg.version}`)) {
      throw new Error(`${pkg.name} ${pkg.version}: MPL source is not in the reviewed source-archive inventory; update it before distributing.`);
    }
  }
  const files = new Map();
  const lines = ['pst — THIRD-PARTY SOURCE ARCHIVES', '',
    'These original, unmodified .crate archives provide the source code for the',
    'listed MPL-2.0 components. They are distributed under Mozilla Public License',
    '2.0; its complete terms appear below. This does not assign a license to pst.', '',
    'The same conservative source set accompanies Windows and macOS releases;',
    'a platform may not link every listed component. Build-time components are',
    'included too. Each archive is the original crates.io tar.gz download, verified',
    'against the reviewed checksum and the archive checksum in Cargo.lock.',
    'Extract an archive with any tar.gz tool, for example:',
    '  tar -xzf selectors-0.38.0.crate', '',
    'The release page distributes these same archives and this source notice.',
    'Their upstream URLs below are an additional way to retrieve the source.', '',
  ];
  for (const item of [...upstream.sourceArchives].sort((a, b) => compare(a.name, b.name))) {
    const pkg = [...allPackages.values()].find(pkg => pkg.name === item.name && pkg.version === item.version && pkg.source === item.source);
    if (!pkg || pkg.license !== item.license) throw new Error(`${item.name} ${item.version}: reviewed source archive no longer matches the locked metadata.`);
    const crateRoot = dirname(pkg.manifest_path);
    const indexDirectory = dirname(crateRoot);
    if (basename(dirname(indexDirectory)) !== 'src') throw new Error(`${item.name}: could not locate the original Cargo registry archive for this source layout.`);
    const filename = `${item.name}-${item.version}.crate`;
    const archive = resolve(crateRoot, '../../..', 'cache', basename(indexDirectory), filename);
    const bytes = readFileSync(archive);
    const checksum = lockChecksums.get(`${item.name}@${item.version} ${item.source}`);
    if (sha256(bytes) !== item.sha256 || checksum !== item.sha256) throw new Error(`${filename}: source-archive checksum mismatch.`);
    files.set(filename, bytes);
    lines.push(`${item.name} ${item.version}`, `License: ${item.license}`, `Archive: ${filename}`,
      `SHA-256: ${item.sha256}`, `Original source: ${item.url}`, `Repository: ${item.repository}`, '');
  }
  const mpl = Object.values(upstream.documents).find(document => document.origins.some(origin => origin.path === 'text/MPL-2.0.txt'));
  if (!mpl) throw new Error('The source-archive notice is missing its reviewed full MPL-2.0 text.');
  files.set('README.txt', Buffer.from(`${lines.join('\n')}\n${DIVIDER}\nMozilla Public License 2.0\n${DIVIDER}\n\n${mpl.text}`));
  return files;
}

function command(cargo, args) {
  const result = spawnSync(cargo, args, { cwd: PROJECT_ROOT, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new Error(`Could not run ${cargo} ${args.join(' ')}.\n${result.error?.message ?? result.stderr ?? result.stdout}`);
  }
  return result.stdout;
}

function parseArguments(args) {
  const options = { targets: [], features: [], output: 'src-tauri/THIRD_PARTY_RUST.txt', cargo: process.env.CARGO || 'cargo', check: false };
  for (let i = 0; i < args.length; i += 1) {
    const argument = args[i];
    if (argument === '--check') options.check = true;
    else if (argument === '--help') options.help = true;
    else if (['--target', '--features', '--output', '--cargo'].includes(argument) && args[i + 1]) {
      const value = args[++i];
      if (argument === '--target') options.targets.push(...value.split(',').filter(Boolean));
      else if (argument === '--features') options.features.push(...value.split(',').filter(Boolean));
      else options[argument.slice(2)] = value;
    } else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  return options;
}

export function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    console.log('Usage: node scripts/desktop-licenses.mjs --target <triple> [--target <triple>] [--features <comma-list>] [--check] [--cargo <path>] [--output <path>]');
    return;
  }
  if (!options.targets.length) {
    const host = command(options.cargo, ['--version', '--verbose']).match(/^host:\s*(\S+)/m)?.[1];
    if (!host) throw new Error('Could not determine the Cargo host; pass an explicit --target.');
    options.targets.push(host);
  }
  const targets = [...new Set(options.targets)].sort(compare);
  const features = [...new Set(options.features)].sort(compare);
  const manifest = resolve(PROJECT_ROOT, 'src-tauri/Cargo.toml');
  const lockFile = resolve(PROJECT_ROOT, 'src-tauri/Cargo.lock');
  if (!existsSync(lockFile)) throw new Error('src-tauri/Cargo.lock is missing. Resolve and review the locked dependencies first.');
  const lock = readFileSync(lockFile);
  const upstream = loadUpstreamLicenses();
  const allPackages = new Map();
  const graphs = targets.map(target => {
    const args = ['metadata', '--format-version', '1', '--locked', '--manifest-path', manifest, '--filter-platform', target];
    if (features.length) args.push('--features', features.join(','));
    const metadata = JSON.parse(command(options.cargo, args));
    for (const pkg of metadata.packages) allPackages.set(pkg.id, pkg);
    return resolvedPackages(metadata, target);
  });
  if (sha256(readFileSync(lockFile)) !== sha256(lock)) throw new Error('Cargo.lock changed during notice generation; rerun against a stable lockfile.');
  const graph = mergePackageGraphs(graphs);
  const text = createNoticeDocument(graph, { targets, lockHash: sha256(lock), features, upstream });
  const sources = prepareSourceArchives(allPackages, graph, upstream, lock.toString('utf8'));
  const output = resolve(PROJECT_ROOT, options.output);
  const sourceDirectory = resolve(PROJECT_ROOT, 'src-tauri/THIRD_PARTY_SOURCES');
  if (options.check) {
    if (!existsSync(output) || readFileSync(output, 'utf8') !== text) {
      throw new Error(`${options.output} does not match the locked sources and requested targets. Regenerate it before packaging.`);
    }
    const names = existsSync(sourceDirectory) ? readdirSync(sourceDirectory).sort(compare) : [];
    if (JSON.stringify(names) !== JSON.stringify([...sources.keys()].sort(compare))
      || [...sources].some(([name, bytes]) => !readFileSync(resolve(sourceDirectory, name)).equals(bytes))) {
      throw new Error('THIRD_PARTY_SOURCES does not match the reviewed, locked source archives. Regenerate it before packaging.');
    }
    console.log(`Verified ${graph.size} Rust crates and their notice files for ${targets.join(', ')}.`);
  } else {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, text);
    rmSync(sourceDirectory, { recursive: true, force: true });
    mkdirSync(sourceDirectory, { recursive: true });
    for (const [name, bytes] of sources) writeFileSync(resolve(sourceDirectory, name), bytes);
    console.log(`Wrote ${options.output}: ${graph.size} Rust crates for ${targets.join(', ')}; ${sources.size - 1} verified original source archives.`);
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
