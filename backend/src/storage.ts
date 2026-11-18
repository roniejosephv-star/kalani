import { mkdir, open, rename, readFile, rm, chmod } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openNodeSqliteDatabase } from '@earendil-works/pi-durable/storage/sqlite/node';
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite';
import { AppError } from './domain.js';

export async function openStorage(directory: string) {
 const root = resolve(directory);
 await mkdir(root, { recursive: true, mode: 0o700 }); await chmod(root, 0o700);
 // This empty database is only an OS-released exclusive writer lease; all application state lives in Pi.
 const lease = new DatabaseSync(join(root, 'writer-lease.sqlite'));
 try { lease.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE'); } catch { lease.close(); throw new Error('Another process owns this Pi storage.'); }
 try {
  const database = await openNodeSqliteDatabase(join(root, 'farm.sqlite'));
  await database.exec('PRAGMA synchronous=FULL');
  const setting = await database.get<{ synchronous: number }>('PRAGMA synchronous');
  if (setting?.synchronous !== 2) { await database.close(); throw new Error('SQLite synchronous=FULL was not established.'); }
  const storage = await SqliteStorage.open(database);
  return { storage, root, synchronous: setting.synchronous, release: () => { lease.close(); } };
 } catch (error) { lease.close(); throw error; }
}
export class AudioStore {
 constructor(private root: string) {}
 private directory(owner: string) { return join(this.root, 'audio', createHash('sha256').update(owner).digest('hex')); }
 private file(owner: string, id: string) {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(id)) throw new AppError('invalid_audio_id', 'Invalid audio reference.');
  return join(this.directory(owner), id);
 }
 async write(owner: string, id: string, audio: Buffer) {
  if (audio.length === 0 || audio.length > 10*1024*1024) throw new AppError('audio_size', 'Audio must be between 1 byte and 10 MiB.');
  await mkdir(this.directory(owner), { recursive: true, mode: 0o700 });
  const final = this.file(owner,id), temporary = `${final}.${randomUUID()}.partial`;
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(audio); await file.sync(); } finally { await file.close(); }
  await rename(temporary, final);
  const dir = await open(this.directory(owner), 'r'); try { await dir.sync(); } finally { await dir.close(); }
  return { size: audio.length, digest: createHash('sha256').update(audio).digest('hex') };
 }
 async read(owner: string, id: string) { return readFile(this.file(owner,id)); }
 async removeOwner(owner: string) { await rm(this.directory(owner), { recursive: true, force: true }); }
}
