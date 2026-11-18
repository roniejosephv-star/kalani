import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { backup as sqliteBackup, DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { BACKGROUND_CONTEXT as ctx } from '@earendil-works/chord/context';
import type { ConversationId } from '@earendil-works/pi-durable';
import { AppError, DirectoryDoc, MetricsDoc, FarmDoc, type FarmerState } from './domain.js';
import { candidatePlaybook, evaluateProposal, proposeImprovements, releaseProposal, reviewPlaybook, rollbackRelease, type EvaluationInput } from './learning.js';
import { openFarmRuntime, type FarmRuntime } from './runtime.js';

const usage = `Local farm operator commands (stop the backend first):
  npm run admin -- provision <owner> [--output-file <private-token-file>]
  npm run admin -- trace <owner>
  npm run admin -- learning <owner>
  npm run admin -- metrics <owner>
  npm run admin -- propose <owner>
  npm run admin -- candidate <owner> <completed-task-id>
  npm run admin -- review-playbook <owner> <playbook-id> <reviewer>
  npm run admin -- evaluate <owner> <proposal-id> <evaluation-json-file>
  npm run admin -- approve-release <owner> <proposal-id> <reviewer>
  npm run admin -- rollback <owner> <reviewer>
  npm run admin -- backup <new-directory>

FARM_DATA_DIR defaults to .runtime; FARM_ACCESS_FILE defaults to its access.json.
Provision rotates this owner's token. Tokens print only to an interactive terminal;
use --output-file for automation. The destination must not already exist.
Evaluate accepts labelled held-out outcomes; it does not generate passing reports.
Approve-release records a reviewed candidate, without modifying production prompts.
Backup copies a consistent SQLite snapshot, referenced private audio and token hashes.
It excludes plaintext token files, provider keys and external source configuration.
Quote reviewer names containing spaces. Trace/learning output contains private data.`;

function ownerId(value: string | undefined): string {
  if (!value || !/^[A-Za-z0-9_-]{1,80}$/.test(value) || ['constructor', '__proto__', 'prototype', 'toString', 'valueOf', 'hasOwnProperty'].includes(value)) throw new AppError('invalid_owner', 'Owner must contain 1–80 letters, digits, underscores or hyphens and cannot be a reserved object key.');
  return value;
}

async function readJSON(file: string, missing?: unknown): Promise<unknown> {
  try {
    const stat = await lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1_000_000) throw new AppError('invalid_file', 'Configuration/report must be a regular file under 1 MB.');
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' && missing !== undefined) return missing;
    if (error instanceof AppError) throw error;
    throw new AppError('invalid_file', 'Configuration/report could not be read as JSON.');
  }
}

async function atomicJSON(file: string, value: unknown) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.partial`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); await handle.sync();
  } finally { await handle.close(); }
  try {
    await rename(temporary, file); await chmod(file, 0o600);
    const directory = await open(dirname(file), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await rm(temporary, { force: true }); }
}

async function provision(owner: string, directory: string, outputFile: string | undefined) {
  if (!outputFile && (!process.stdout.isTTY || !process.stdin.isTTY)) throw new AppError('private_output_required', 'Use --output-file for non-interactive provisioning; token output to logs is disabled.');
  const file = resolve(process.env.FARM_ACCESS_FILE ?? `${directory}/access.json`);
  const access = await readJSON(file, []);
  if (!Array.isArray(access) || access.some(entry => !entry || typeof entry.owner !== 'string' || !/^[0-9a-f]{64}$/.test(entry.tokenHash))) throw new AppError('invalid_access', 'Access configuration is invalid.');
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  let tokenWritten = false;
  try {
    if (outputFile) {
      const handle = await open(resolve(outputFile), 'wx', 0o600);
      try { await handle.writeFile(`${token}\n`); await handle.sync(); tokenWritten = true; } finally { await handle.close(); }
    }
    await atomicJSON(file, [...access.filter(entry => entry.owner !== owner), { owner, tokenHash }]);
  } catch (error) {
    if (outputFile && tokenWritten) await rm(resolve(outputFile), { force: true });
    throw error;
  }
  if (outputFile) process.stdout.write(`${JSON.stringify({ owner, tokenFile: resolve(outputFile), rotated: access.some(entry => entry.owner === owner) })}\n`);
  else process.stdout.write(`${token}\n`);
}

function filteredTrace(state: FarmerState) {
  return state.traces.map(trace => {
    let raw: Record<string, unknown> = {};
    try { const parsed = JSON.parse(trace.summary); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) raw = parsed; } catch { /* Malformed legacy contributions are omitted. */ }
    const contribution: Record<string, unknown> = {};
    for (const key of ['kind', 'summary', 'applicability']) if (typeof raw[key] === 'string') contribution[key] = raw[key].slice(0, 2000);
    for (const key of ['missingFacts', 'uncertainty']) if (Array.isArray(raw[key])) contribution[key] = raw[key].filter((value): value is string => typeof value === 'string').slice(0, 20).map(value => value.slice(0, 1200));
    return { role: trace.role, at: trace.at, messageId: trace.messageId, contextVersion: trace.contextVersion, evidenceIds: trace.evidenceIds, contribution };
  });
}

async function syncDirectory(path: string) {
  const directory = await open(path, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function createBackup(runtime: FarmRuntime, directory: string, destination: string) {
  const root = await realpath(directory);
  const requested = resolve(destination);
  const target = join(await realpath(dirname(requested)), basename(requested));
  const within = relative(root, target);
  if (!within || (!within.startsWith(`..${sep}`) && within !== '..' && !within.startsWith(sep))) throw new AppError('invalid_backup_target', 'Choose a new backup directory outside the live data directory.');
  await mkdir(target, { mode: 0o700 });
  const files: { path: string; size: number; sha256: string }[] = [];
  const record = async (path: string) => {
    const hash = createHash('sha256'); let size = 0;
    for await (const chunk of createReadStream(join(target, path))) { hash.update(chunk); size += chunk.length; }
    files.push({ path, size, sha256: hash.digest('hex') });
  };
  const privateFile = async (path: string, bytes: Buffer) => {
    const filename = join(target, path);
    await mkdir(dirname(filename), { recursive: true, mode: 0o700 });
    const handle = await open(filename, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await syncDirectory(dirname(filename));
    await record(path);
  };
  try {
    const source = new DatabaseSync(join(root, 'farm.sqlite'), { readOnly: true });
    try { await sqliteBackup(source, join(target, 'farm.sqlite')); } finally { source.close(); }
    const copied = new DatabaseSync(join(target, 'farm.sqlite'));
    try {
      copied.exec('PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;');
      const check = copied.prepare('PRAGMA quick_check').get();
      if (check?.quick_check !== 'ok') throw new AppError('invalid_backup', 'SQLite backup integrity check failed.');
    } finally { copied.close(); }
    await chmod(join(target, 'farm.sqlite'), 0o600);
    const databaseFile = await open(join(target, 'farm.sqlite'), 'r');
    try { await databaseFile.sync(); } finally { await databaseFile.close(); }
    await record('farm.sqlite');
    const directoryState = await runtime.harness.snapshot(DirectoryDoc, ctx);
    for (const [owner, conversationId] of Object.entries(directoryState?.farmers ?? {})) {
      const state = await runtime.harness.snapshot(FarmDoc, conversationId as ConversationId, ctx);
      if (!state) throw new AppError('invalid_backup_state', 'A farmer directory entry has no persistent state.');
      const ownerDirectory = createHash('sha256').update(owner).digest('hex');
      for (const [id, metadata] of Object.entries(state.media)) {
        if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id)) throw new AppError('invalid_audio_id', 'A media reference cannot be safely backed up.');
        const path = join('audio', ownerDirectory, id);
        const sourcePath = join(root, path);
        const stat = await lstat(sourcePath);
        if (!stat.isFile() || stat.isSymbolicLink() || await realpath(sourcePath) !== sourcePath || stat.size > 10 * 1024 * 1024) throw new AppError('invalid_backup_media', 'Referenced audio is not a regular private media file.');
        const bytes = await readFile(sourcePath);
        if (bytes.length !== metadata.size || createHash('sha256').update(bytes).digest('hex') !== metadata.digest) throw new AppError('invalid_backup_media', 'Referenced audio failed its recorded integrity check.');
        await privateFile(path, bytes);
      }
    }
    const access = await readJSON(resolve(process.env.FARM_ACCESS_FILE ?? join(root, 'access.json')), []);
    if (!Array.isArray(access) || access.some(entry => !entry || typeof entry.owner !== 'string' || !/^[0-9a-f]{64}$/.test(entry.tokenHash))) throw new AppError('invalid_access', 'Access configuration cannot be safely backed up.');
    await privateFile('access.json', Buffer.from(`${JSON.stringify(access.map(entry => ({ owner: entry.owner, tokenHash: entry.tokenHash })), null, 2)}\n`));
    await atomicJSON(join(target, 'manifest.json'), { format: 'farm-backup-v1', createdAt: new Date().toISOString(), piVersion: '1.5.2', files, excludes: ['plaintext session tokens', 'provider credentials', 'external catalogue and market mapping files', 'unreferenced or partial audio'], restore: 'Stop the backend. Verify hashes and restore into a new private FARM_DATA_DIR. Configure external providers/catalogues separately; original session tokens remain necessary or must be rotated.' });
    const audioRoot = join(target, 'audio');
    try { await syncDirectory(audioRoot); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    await syncDirectory(target); await syncDirectory(dirname(target));
    return { format: 'farm-backup-v1', directory: target, files: files.length, containsPrivateData: true };
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

export async function main(args = process.argv.slice(2)) {
  const [command, ownerArgument, ...parameters] = args;
  if (!command || ['help', '--help', '-h'].includes(command)) { process.stdout.write(`${usage}\n`); return; }
  if (command === 'backup') {
    if (!ownerArgument || parameters.length) throw new AppError('invalid_arguments', 'Use backup <new-directory>.');
    const directory = resolve(process.env.FARM_DATA_DIR ?? '.runtime');
    const database = await lstat(join(directory, 'farm.sqlite'));
    if (!database.isFile() || database.isSymbolicLink()) throw new AppError('invalid_database', 'An existing regular Pi database is required.');
    const runtime = await openFarmRuntime({ directory, resume: false });
    try { process.stdout.write(`${JSON.stringify(await createBackup(runtime, directory, ownerArgument))}\n`); } finally { await runtime.close(); }
    return;
  }
  const arities: Record<string, number> = { trace: 0, learning: 0, metrics: 0, propose: 0, candidate: 1, 'review-playbook': 2, evaluate: 2, 'approve-release': 2, rollback: 1 };
  if (!Object.hasOwn(arities, command) && command !== 'provision') throw new AppError('unknown_command', 'Unknown operator command. Run admin --help.');
  if (command === 'provision' ? !(parameters.length === 0 || (parameters.length === 2 && parameters[0] === '--output-file' && !!parameters[1])) : parameters.length !== arities[command]) throw new AppError('invalid_arguments', 'Unexpected arguments. Run admin --help.');
  const owner = ownerId(ownerArgument);
  const directory = resolve(process.env.FARM_DATA_DIR ?? '.runtime');
  const runtime = await openFarmRuntime({ directory, resume: false });
  try {
    if (command === 'provision') {
      await runtime.ensureFarmer(owner);
      await provision(owner, directory, parameters[1]);
      return;
    }
    const directoryState = await runtime.harness.snapshot(DirectoryDoc, ctx);
    if (!directoryState || !Object.hasOwn(directoryState.farmers, owner)) throw new AppError('not_found', 'Farmer was not found; no record was created.', 404);
    const id = await runtime.ensureFarmer(owner);
    if(command==='metrics'){
      const operations=await runtime.harness.snapshot(MetricsDoc,ctx);
      const usage=await runtime.harness.usage(ctx);
      process.stdout.write(`${JSON.stringify({format:'farm-service-metrics-v1',scope:'aggregate service; operator only',operations:operations?.operations??{},usage},null,2)}\n`);return;
    }
    if (command === 'trace' || command === 'learning') {
      const state = await runtime.harness.snapshot(FarmDoc, id, ctx);
      if (!state) throw new AppError('not_found', 'Farmer state was not found.', 404);
      const result = command === 'trace' ? { format: 'farm-agent-log-v1', owner, entries: filteredTrace(state) } : { format: 'farm-learning-v1', owner, memories: state.memories, experiences: state.experiences, playbooks: state.playbooks, proposals: state.proposals, approvedCandidate: state.activeRelease, releaseHistory: state.releaseHistory ?? [], productionActivation: 'Separate reviewed configuration/code change required.' };
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return;
    }
    const evaluation = command === 'evaluate' ? await readJSON(resolve(parameters[1])) as EvaluationInput : undefined;
    const result = await runtime.harness.commit(async tx => {
      const state = await tx.doc(FarmDoc, id);
      switch (command) {
        case 'propose': return proposeImprovements(state);
        case 'candidate': return candidatePlaybook(state, parameters[0]);
        case 'review-playbook': return reviewPlaybook(state, parameters[0], parameters[1]);
        case 'evaluate': return evaluateProposal(state, parameters[0], evaluation!);
        case 'approve-release': return releaseProposal(state, parameters[0], parameters[1]);
        case 'rollback': return { approvedCandidate: rollbackRelease(state, parameters[0]) };
        default: throw new AppError('unknown_command', 'Unknown operator command.');
      }
    }, ctx);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally { await runtime.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) {
    process.stderr.write(`${error instanceof AppError ? `${error.code}: ${error.message}` : 'Operator command failed. Check local configuration and stop the backend before retrying.'}\n`);
    process.exitCode = 1;
  }
}
