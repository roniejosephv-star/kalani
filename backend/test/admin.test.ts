import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createBackup, filteredTrace } from '../src/admin.js';
import { emptyFarmer } from '../src/domain.js';
import { openFarmRuntime } from '../src/runtime.js';

test('operator trace exposes workflow timing and outcome without raw provider fields', () => {
  const state = emptyFarmer();
  const entry = {
    role: 'weather', at: '2026-11-20T00:00:00Z', messageId: 'fixture', contextVersion: 1, evidenceIds: [],
    summary: JSON.stringify({ stage: 'collect', round: 1, outcome: 'supported', durationMs: 25, rawAudio: 'private', token: 'secret' }),
  };
  state.traces.push(entry, { ...entry, summary: JSON.stringify({ stage: 'unknown', round: 4, durationMs: -1 }) });
  assert.deepEqual(filteredTrace(state), [
    { role: 'weather', at: entry.at, messageId: 'fixture', contextVersion: 1, evidenceIds: [], stage: 'collect', round: 1, outcome: 'supported', durationMs: 25, contribution: {} },
    { role: 'weather', at: entry.at, messageId: 'fixture', contextVersion: 1, evidenceIds: [], contribution: {} },
  ]);
});

test('backup restores Pi state and complete private audio, preserves hashes and excludes plaintext tokens', async () => {
  const root = await mkdtemp('/private/tmp/farm-backup-test-');
  const source = join(root, 'source'), target = join(root, 'backup');
  const runtime = await openFarmRuntime({ directory: source, resume: false });
  try {
    await runtime.facts('farmer-a', { requestId: 'facts-fixture-1', expectedVersion: 0, facts: { crop: 'paddy', village: 'Fixture village' }, fieldId: 'field-1', cycleId: 'cycle-1' });
    const bytes = Buffer.from('private test recording; never submitted to a provider');
    const mediaId = await runtime.upload('farmer-a', 'audio-fixture-1', bytes, 'audio/mp4');
    await runtime.ensureFarmer('deleted-farmer');
    await runtime.remove('deleted-farmer', 'delete-fixture-1');
    const tokenHash = createHash('sha256').update('fixture-secret').digest('hex');
    await writeFile(join(source, 'access.json'), JSON.stringify([{ owner: 'farmer-a', tokenHash, accidentalPlaintext: 'must-not-copy' }]), { mode: 0o600 });
    await writeFile(join(source, 'demo-token'), 'must-not-copy', { mode: 0o600 });
    const result = await createBackup(runtime, source, target);
    assert.equal(result.containsPrivateData, true);
    assert.deepEqual((await readdir(target)).sort(), ['access.json', 'audio', 'farm.sqlite', 'manifest.json']);
    assert.equal((await stat(target)).mode & 0o777, 0o700);
    assert.equal((await stat(join(target, 'farm.sqlite'))).mode & 0o777, 0o600);
    assert.equal((await stat(join(target, 'access.json'))).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(join(target, 'access.json'), 'utf8')), [{ owner: 'farmer-a', tokenHash }]);
    const manifest = JSON.parse(await readFile(join(target, 'manifest.json'), 'utf8'));
    for (const file of manifest.files) {
      const content = await readFile(join(target, file.path));
      assert.equal(content.length, file.size);
      assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256);
      assert.equal((await stat(join(target, file.path))).mode & 0o777, 0o600);
    }
    const restored = await openFarmRuntime({ directory: target, resume: false });
    try {
      assert.equal((await restored.state('farmer-a')).facts.crop, 'paddy');
      assert.deepEqual((await restored.getAudio('farmer-a', mediaId)).bytes, bytes);
      await assert.rejects(restored.state('deleted-farmer'), { code: 'account_deleted' });
    } finally { await restored.close(); }
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test('backup rejects overwrite and live-directory descendants without removing existing files', async () => {
  const root = await mkdtemp('/private/tmp/farm-backup-test-');
  const source = join(root, 'source');
  const runtime = await openFarmRuntime({ directory: source, resume: false });
  try {
    await writeFile(join(root, 'sentinel'), 'preserve');
    await assert.rejects(createBackup(runtime, source, root), { code: 'EEXIST' });
    await assert.rejects(createBackup(runtime, source, join(source, 'backup')), { code: 'invalid_backup_target' });
    assert.equal(await readFile(join(root, 'sentinel'), 'utf8'), 'preserve');
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test('backup integrity failure removes only its newly created target', async () => {
  const root = await mkdtemp('/private/tmp/farm-backup-test-');
  const source = join(root, 'source'), target = join(root, 'failed-backup');
  const runtime = await openFarmRuntime({ directory: source, resume: false });
  try {
    const id = await runtime.upload('farmer-a', 'audio-fixture-2', Buffer.from('original'), 'audio/mp4');
    await runtime.audio.write('farmer-a', id, Buffer.from('corrupt'));
    await assert.rejects(createBackup(runtime, source, target), { code: 'invalid_backup_media' });
    await assert.rejects(stat(target), { code: 'ENOENT' });
    assert.equal((await stat(join(source, 'farm.sqlite'))).isFile(), true);
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
});

test('backup CLI refuses while another process holds the application writer lease', async () => {
  const root = await mkdtemp('/private/tmp/farm-backup-test-');
  const source = join(root, 'source'), target = join(root, 'blocked-backup');
  const runtime = await openFarmRuntime({ directory: source, resume: false });
  try {
    await assert.rejects(promisify(execFile)(process.execPath, ['--import', 'tsx', 'src/admin.ts', 'backup', target], { cwd: process.cwd(), env: { ...process.env, FARM_DATA_DIR: source }, timeout: 10_000 }), error => {
      assert.match((error as { stderr: string }).stderr, /stop the backend/); return true;
    });
    await assert.rejects(stat(target), { code: 'ENOENT' });
  } finally { await runtime.close(); await rm(root, { recursive: true, force: true }); }
});
