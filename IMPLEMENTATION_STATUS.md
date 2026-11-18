# Kalani simulator verification

Use [pstack's bug-fix workflow](https://github.com/cursor/plugins/blob/main/pstack/skills/poteto-mode/playbooks/bug-fix.md): reproduce, trace the failing boundary, fix the smallest proven surface, then rerun the original journey. Two saved Claude response shapes reproduce the incident: wrong list types, and JSON with trailing prose. Regression tests show they now get one bounded repair; invalid citations still prevent publication.

- **Deterministic:** Run `cd backend && npm run check`. Covers five synthetic profiles (including a location correction that removes coordinates), unavailable sources, language isolation during an in-flight request, stale approval, duplicate send, authenticated event reconnection, restart recovery, and text retention when speech generation fails.
- **Live simulator:** Provision a disposable farmer with confirmed demo coordinates using the existing admin commands. Run the backend with a separate `FARM_DATA_DIR` and `PORT=18787`. Use both provider keys in the backend only. With a short AAC/M4A fixture containing the equivalent rain question in each language, run from the repo root:

  ```sh
  FARM_TEST_LOCALE=ta-IN bash ios/FarmAssistantUITests/run-voice-test.sh \
    "$SIMULATOR_UDID" "$DISPOSABLE_TOKEN_FILE" "$TAMIL_M4A"
  FARM_TEST_LOCALE=en-IN bash ios/FarmAssistantUITests/run-voice-test.sh \
    "$SIMULATOR_UDID" "$DISPOSABLE_TOKEN_FILE" "$ENGLISH_M4A"
  ```

  The test uses a separate simulator app ID, changes the language from My Farm when needed, previews and uploads the audio, waits for a **new** reply, and checks play → finish → replay → finish. It opens all four tabs. Check the disposable farmer's state to confirm the transcript, reply language, and Open-Meteo citation. Keep the private XCTest result directory off shared drives and out of Git.
- **Microphone and speaker:** In the simulator, record “இந்த வாரம் மழை பெய்யுமா?” or “Will it rain this week?” instead of loading a fixture. Grant microphone access, preview, send, and listen to both plays. The test script also takes `--mic` in place of the fixture when someone can supply the phrase as it records. Audio player state alone does not verify audible output or microphone quality.
- **Before a wider demo:** Check first-run farm confirmation, permission denial, draft recovery, app reconnect, visible evidence and stale guidance, local notification, and export/deletion on a disposable session. The five profiles are development fixtures. Live crop, market, and scheme coverage requires configured reviewed sources; simulator reminders do not imply production push.
