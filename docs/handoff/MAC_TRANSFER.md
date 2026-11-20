# Restore Kalani on another Mac

Use `exports/kalani-source-<sha>.zip` or clone the public repository at the exported commit, plus the separate AES-256 encrypted `exports/kalani-private-<sha>.dmg`. This procedure preserves the existing demo state without copying a whole Simulator or developer account. The exact artifact names, hashes and private inventory supplied with the export are authoritative.

## 1. Establish the transfer boundary

Keep the source Mac backend stopped after the final snapshot. Confirm it remains stopped before starting the restored copy. Independently running copies can resume the same work/reminders and incur provider calls. Keep the original export unchanged as the rollback point.

Verify the source ZIP and DMG with their supplied SHA-256 values, then mount the DMG interactively; do not put its password in a shell command:

```sh
shasum -a 256 /absolute/path/to/kalani-source.zip
shasum -a 256 /absolute/path/to/kalani-private.dmg
hdiutil attach -readonly /absolute/path/to/kalani-private.dmg
```

Choose the actual paths on the destination Mac; placeholders below are not paths from the source computer:

```sh
export KALANI_SOURCE="/absolute/path/to/checked-out-source"
export KALANI_PRIVATE_EXPORT="/Volumes/Kalani Private Transfer"
export KALANI_RESTORE="$HOME/Library/Application Support/Kalani/runtime-transfer"
umask 077
```

The private root contains `runtime/` (direct children `farm.sqlite`, optional `audio/`, `access.json`, `manifest.json`), `secrets/backend.env`, available `secrets/session-tokens/`, selected `client-state/`, `evidence/` and `archive/`, with export metadata/inventory. Runtime backup omits plaintext tokens, provider secrets, reviewed external configuration, raw journals and unreferenced/partial audio. The private export adds only separately inventoried available material. GitHub PATs, macOS Keychain and Claude-account credentials are not transferred.

The mounted volume contains these folders directly. Adjust `KALANI_PRIVATE_EXPORT` to its actual mount point if macOS adds a numeric suffix. The root `manifest.json` records the full source commit and a checksum inventory for the private payload; the separate `runtime/manifest.json` describes the authoritative backend snapshot.

## 2. Install and verify the tested tools

Install **Node 26.12.1** and **Xcode 27.2**, open Xcode to complete its setup and install an iOS 26.2 Simulator if available. Verify the selected tools:

```sh
node --version
xcodebuild -version
xcrun simctl list devices available
cd "$KALANI_SOURCE/backend"
npm ci
npm run check
```

The 20 November baseline is **99 tests passing**. Investigate any discrepancy before continuing. If a restricted shell cannot bind the HTTP test's loopback socket, use permitted local networking and preserve that separate result. Do not count a blocked test as passed. Keep Pi's four packages pinned at 1.5.2.

Configure Git identity locally in this repository before committing:

```sh
git -C "$KALANI_SOURCE" config user.name roniejosephv-star
git -C "$KALANI_SOURCE" config user.email 287225900+roniejosephv-star@users.noreply.github.com
```

## 3. Validate and copy the snapshot while stopped

The admin backup's `manifest.json` lists each payload file's relative path, size and SHA-256. It does not authenticate itself; validate the outer artifact/export hashes first. Run this before opening the database through the application:

```sh
node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile, lstat} from 'node:fs/promises';
import {resolve, sep} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
const root = resolve(process.env.KALANI_PRIVATE_EXPORT, 'runtime');
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.format, 'farm-backup-v1');
assert.equal(manifest.piVersion, '1.5.2');
for (const file of manifest.files) {
  const path = resolve(root, file.path);
  assert.ok(path.startsWith(root + sep));
  const stat = await lstat(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink());
  const bytes = await readFile(path);
  assert.equal(bytes.length, file.size, file.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.path);
}
assert.ok(manifest.files.some(f => f.path === 'farm.sqlite'));
assert.ok(manifest.files.some(f => f.path === 'access.json'));
const db = new DatabaseSync(resolve(root, 'farm.sqlite'), {readOnly:true});
try { assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok'); }
finally { db.close(); }
console.log('Runtime hashes, sizes and SQLite quick_check passed.');
JS

test ! -e "$KALANI_RESTORE" || { echo "Choose a new restore directory" >&2; exit 1; }
mkdir -p "$(dirname "$KALANI_RESTORE")"
ditto "$KALANI_PRIVATE_EXPORT/runtime" "$KALANI_RESTORE"
chmod -R go-rwx "$KALANI_RESTORE"
```

Do not replace an existing runtime or copy a live `farm.sqlite` alone. `npm run admin -- backup NEW_DIRECTORY` is the supported backup command; **there is no restore command**. Restore is the validated copy above. Do not import SQLite rows into a new empty runtime or reconstruct Pi state from exported conversation JSON.

Inspect the restored copy without resuming tasks or loading provider secrets:

```sh
cd "$KALANI_SOURCE/backend"
FARM_DATA_DIR="$KALANI_RESTORE" node --import tsx --input-type=module <<'JS'
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {openFarmRuntime} from './src/runtime.ts';
const directory = process.env.FARM_DATA_DIR;
const access = JSON.parse(await readFile(join(directory, 'access.json'), 'utf8'));
const runtime = await openFarmRuntime({directory, resume:false});
try {
  for (const {owner} of access) {
    try {
      const state = await runtime.state(owner);
      console.log(JSON.stringify({owner, messages:state.messages.length,
        tasks:state.tasks.length, calendarEntries:(state.calendarEntries ?? []).length}));
    } catch (error) {
      if (error.code !== 'account_deleted') throw error;
      console.log(JSON.stringify({owner, status:'account_deleted'}));
    }
  }
} finally { await runtime.close(); }
JS
```

Compare these private counts to the export inventory. The inspection can create local lease/SQLite bookkeeping files in the restored directory; the mounted snapshot stays unchanged. Review pending reminders/tasks and their dates before normal startup. Resume may immediately process overdue work.

## 4. Restore private configuration and connect once

Copy `secrets/backend.env` to `backend/.env` only if no destination configuration exists, and restrict it to the current user. Edit it privately: set `FARM_DATA_DIR` to the new absolute restored path; remove source-Mac overrides for `FARM_ACCESS_FILE` or point it at the restored `access.json`. Resolve optional catalogue/market-mapping paths from the inventory or leave them unconfigured. Keep `KALANI_PILOT_LANGUAGES` empty. Do not paste secrets into chat, Git, a shared scheme or the app.

```sh
cd "$KALANI_SOURCE/backend"
test ! -e .env || { echo "Review existing .env before replacing it" >&2; exit 1; }
cp "$KALANI_PRIVATE_EXPORT/secrets/backend.env" .env
chmod 600 .env
```

Use the available original farmer session token matching the restored owner. `access.json` contains hashes, not recoverable plaintext tokens. **Provision rotates a token**: avoid re-provisioning merely to reconnect. The original token is also needed to reach that session's existing client draft directory, which is named `SHA256(token)`.

If the original token is unavailable, preserve the old client data first, then provision a replacement while the backend is stopped using `npm run admin -- provision OWNER --output-file NEW_PRIVATE_TOKEN_FILE`. Reconnect with that token. The server history remains owner-based, but old token-scoped client drafts do not automatically migrate. Document that recovery separately.

Only after confirming the source runtime is stopped and inspection is satisfactory:

```sh
cd "$KALANI_SOURCE/backend"
FARM_DATA_DIR="$KALANI_RESTORE" npm start
```

In another terminal, `curl -fsS http://127.0.0.1:8787/health` should report the expected configuration flags. A successful health response does not prove valid credentials or provider access. No keys are needed for deterministic tests; real provider checks may incur charges.

## 5. Rebuild and preserve selected Simulator data

Read `client-state/manifest.json` for the source Simulator name/runtime, bundle ID and selected paths. Data is stored under `client-state/<source-simulator-udid>/<bundle-id>/Application Support/` and `Preferences/`; the latter contains only the matching Kalani plist. A test app with the `.stability` suffix is distinct from `local.farmassistant.demo`. Restore to the matching ID, not an arbitrary new app.

Choose an installed destination Simulator and build with signing enabled:

```sh
export SIMULATOR_UDID="YOUR_DESTINATION_SIMULATOR_UDID"
cd "$KALANI_SOURCE"
xcodebuild -project ios/FarmAssistant.xcodeproj -scheme FarmAssistant \
  -destination "platform=iOS Simulator,id=$SIMULATOR_UDID" \
  -derivedDataPath /private/tmp/kalani-transfer-build \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build
xcrun simctl bootstatus "$SIMULATOR_UDID" -b
xcrun simctl install "$SIMULATOR_UDID" \
  /private/tmp/kalani-transfer-build/Build/Products/Debug-iphonesimulator/FarmAssistant.app
```

For a `.stability` build add `FARM_DEMO_SUFFIX=.stability`. Never use `CODE_SIGNING_ALLOWED=NO` for runtime checks: an unsigned build can compile while its Keychain writes fail.

Preserve any existing destination client data before copying. Select the matching inventory entry and set its actual export path and bundle ID below. Terminate the app, obtain its new container, then shut down the Simulator before copying so cached preferences cannot overwrite the restored plist:

```sh
export KALANI_BUNDLE_ID="local.farmassistant.demo"
export KALANI_EXPORTED_APP="$KALANI_PRIVATE_EXPORT/client-state/SOURCE_SIMULATOR_UDID/$KALANI_BUNDLE_ID"
xcrun simctl terminate "$SIMULATOR_UDID" "$KALANI_BUNDLE_ID"
export KALANI_APP_CONTAINER="$(xcrun simctl get_app_container "$SIMULATOR_UDID" "$KALANI_BUNDLE_ID" data)"
xcrun simctl shutdown "$SIMULATOR_UDID"
mkdir -p "$KALANI_APP_CONTAINER/Library/Application Support" "$KALANI_APP_CONTAINER/Library/Preferences"
ditto "$KALANI_EXPORTED_APP/Application Support" "$KALANI_APP_CONTAINER/Library/Application Support"
cp "$KALANI_EXPORTED_APP/Preferences/$KALANI_BUNDLE_ID.plist" "$KALANI_APP_CONTAINER/Library/Preferences/$KALANI_BUNDLE_ID.plist"
xcrun simctl bootstatus "$SIMULATOR_UDID" -b
```

An already-terminated app can report that it is not running; verify the selected Simulator and bundle before proceeding. Copy only paths present in that inventory entry; an absent preference plist is not an instruction to invent one. Do not copy whole Simulator devices, caches, system settings or Keychain.

The app uses `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`: its connection credential is not migrated. Launch and reconnect to `http://127.0.0.1:8787` with the matching original session token from the private export. Enter the farmer token, never a provider key. Recheck the server URL, selected language and audio consent. Confirm the old draft text/recording and history before changing tokens or deleting anything. Exports/drafts are private data and remain outside the public repository.

## 6. Acceptance on the destination Mac

- Confirm restored farm facts, message history, evidence links, calendar entries and draft media against the inventory. Confirm old saved reply audio is retrievable and actually audible on first play and replay.
- Use disposable data for new interactions: switch English/Tamil by tap and voice, send a weather question, check plain-language rain wording and evidence, test typed save/Undo and voice preview/Save. Leave the evaluation session in English.
- Follow [verification instructions](../verification/IMPLEMENTATION_STATUS.md) for fixture tests. Record human microphone/listening separately; a passing playback state is insufficient.
- Preview the portable deck with `python3 -m http.server 8791 --bind 127.0.0.1 --directory pitch-deck/dist`, then open `http://127.0.0.1:8791`. Republishing/editing account-owned presentation assets requires access through the destination user's accounts.
- Record the actual destination tool versions, source commit, checks and unresolved issues. Keep the old Mac stopped until the restored instance is deliberately retired. Eject the private DMG after use with `hdiutil detach /Volumes/MOUNT_NAME`.

If validation fails, stop and preserve the failure evidence. Return to the unchanged mounted snapshot and a different fresh restore directory; do not overwrite the only working copy or repeatedly launch a partially restored runtime.
