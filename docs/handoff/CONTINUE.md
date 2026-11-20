# Continue Kalani on another Mac

Kalani — **A Farmer's Assistant** — was created by **roniejosephv-star**. Start with this file, [DECISIONS.md](DECISIONS.md), then [MAC_TRANSFER.md](MAC_TRANSFER.md). Read the repository's [AGENTS.md](../../AGENTS.md) before changes.

## What is portable

- The public repository and source ZIP contain source, tests, product/architecture documents, design concepts and the static pitch deck. They contain no working farmer sessions or provider credentials.
- A separate AES-256 encrypted DMG contains the validated backend snapshot, existing backend configuration and available session-token files, selected Simulator client data, and private verification/history evidence. Keep it private. Its inventory records the actual contents; absent material has not been recovered by inference.
- The public [pitch Site](https://tamil-farm-assistant-pitch.tawnyforge4.chatgpt.site) and editable ChatGPT presentation `artifact_Qg5XM1IyngdbQurtm-r7ptGEFFcMl6lo` belong to the original tool account. They are references, not transferred accounts or hosting ownership. The portable content is [pitch-deck/dist/deck.json](../../pitch-deck/dist/deck.json), its renderer/assets and [authoring callback](../../pitch-deck/author-presentation.mjs).

## Current checkpoint

The working client is native SwiftUI on iPhone Simulator; Android and farmer-facing web are planned. The backend is TypeScript with Pi Durable/AI/Chord/Schema **1.5.2**, SQLite and private audio files. The verified toolchain is **Node 26.12.1, Xcode 27.2, iOS 26.2 Simulator**. The package minimum alone is not the tested transfer baseline.

On 20 November 2026 the backend build and **99 tests** passed. Signed Simulator checks covered English/Tamil weather, matching replay bytes, manual/spoken language switching, typed calendar save with Undo, and spoken preview/Save. These are synthetic-farm and prerecorded-input checks; they do not establish audible human comprehension, physical microphone reliability or farmer usefulness. Earlier live microphone observations were partial: extra recognized words and Tamil replay were not conclusively resolved. See [verification status](../verification/IMPLEMENTATION_STATUS.md) and the private evidence inventory for the precise runs. Do not turn old failed/interrupted tests into passes or reuse the deck's dated 53-test statement as today's result.

The source Mac backend is to remain stopped after the final snapshot. Restore into a fresh directory, inspect with `resume: false`, and establish one active runtime before normal startup. Never operate two copied runtimes concurrently: they can independently resume reminders and provider work.

## Read next

| Need | Source |
| --- | --- |
| Product intent and acceptance | [PRD](../product/PRD.md), [specifications](../product/PRODUCT_SPECIFICATIONS.md), [farmer flow review](../product/FARMER_FLOW_REVIEW.md) |
| Implemented interface and runtime boundary | [API contract](../architecture/API_CONTRACT.md), [blueprint](../architecture/BLUEPRINT.md), `backend/src/`, `ios/FarmAssistant/` |
| Current proof and open checks | [implementation status](../verification/IMPLEMENTATION_STATUS.md), private `evidence/` inventory |
| Demonstration and portable presentation | [pitch README](../../pitch-deck/README.md), [deck JSON](../../pitch-deck/dist/deck.json) |
| Draft visual direction | [design folder](../design/); storyboard is a concept, not running-app evidence |
| Rationale and superseded proposals | [decision/provenance ledger](DECISIONS.md), private `archive/` |

## Next-agent prompt

```text
Continue Kalani — A Farmer's Assistant, created by roniejosephv-star.
First read AGENTS.md and docs/handoff/{CONTINUE,DECISIONS,MAC_TRANSFER}.md.
Use the exported inventory and checked-out commit as the transfer boundary.
Do not assume access to the original Codex chats, accounts, absolute paths,
Keychain, Site ownership or editable presentation. Historical chats are context;
the decision ledger identifies superseded proposals. Preserve private evidence.

Plan before changes. Verify Node 26.12.1, Xcode 27.2 and the available iOS runtime.
Restore only into a fresh private directory, validate hashes and SQLite, inspect
with resume:false, and keep the source Mac stopped before starting one backend.
Reconnect the Simulator using its original farmer token; preserve selected client
data and preferences without copying the whole Simulator or its Keychain.
Run backend npm ci and npm run check. Build with Simulator signing enabled.
Current baseline is 99 passing backend tests on 20 November 2026; latest voice
checks used prerecorded audio. Record new checks separately from that history.

Keep English/Tamil enabled and the evaluation session in English. Calendar
replaces This Week: exact typed requests save with Undo, interpreted/voice
requests preview before Save. Preserve versioned approvals and evidence limits.
Keep Kannada/Malayalam/Telugu pilots disabled pending native-speaker review.
Android/web, real-device audio, native comprehension, reviewed crop/market/scheme
coverage and production delivery are not completed claims. No new feature is
authorized solely by this handoff. Report the restored end state and open checks.
```

## First useful work after restoration

Complete the transfer checklist, then perform a human microphone/listening check in English and Tamil using disposable farm data. Record transcription, visible reply, actual audible first play and replay, language comprehension, and calendar readback separately. Validate restored history and drafts before rotating tokens. Field research, reviewed source coverage and physical-device evaluation remain separate acceptance work.
