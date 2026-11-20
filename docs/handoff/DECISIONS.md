# Kalani decisions and provenance

This ledger preserves the approved direction at the 20 November 2026 transfer. It distinguishes product commitments, implemented behavior and unfinished acceptance. Actual source and [verification status](../verification/IMPLEMENTATION_STATUS.md) take precedence over a historical proposal's implementation claim.

## Decisions to preserve

| Decision | Rationale and consequence | Evidence |
| --- | --- | --- |
| **Kalani — A Farmer's Assistant**, by **roniejosephv-star** | Tool-account access does not establish authorship. Keep repository-local Git identity; retain source filenames/technical identifiers. | `AGENTS.md`; pitch chat naming correction, 18 November |
| English and Tamil, switchable by tap and explicit speech | A mixed-language question alone does not switch preference. Submitted messages retain their accepted language; existing audio remains in its original language. A delayed speech command cannot override a newer manual choice. | `backend/src/languages.ts`, `backend/src/runtime.ts`, iOS language controls; latest approved language/calendar plan |
| English pitch and evaluation session; two actual language-switch screens | Invigilators need an English usability walkthrough. Preserve the distinction between actual Simulator screens, synthetic scenario and design concept. | Pitch chat corrections and `pitch-deck/README.md` |
| iOS, Android and web product direction; native SwiftUI iPhone demonstration | SwiftUI is the selected current client. Android and farmer-facing web remain planned. The public pitch website is a presentation. | Product specifications; pitch platform correction |
| One TypeScript Pi Durable backend, pinned compatible packages **1.5.2** | Pi owns durable conversations, application documents and workflows. SQLite is authoritative, one writer only. FastAPI/Python/PostgreSQL and additional independent orchestration loops are retired proposals. | `backend/package-lock.json`, `backend/src/runtime.ts`, architecture documents |
| Authenticated, versioned farmer control | Extracted facts require confirmation. Task approval, reported completion, postponement and rejection are distinct. Completion is farmer-reported, not measured agronomic efficacy. Approval performs no external farm action. | Product specifications, API contract, runtime tests |
| Relevant, bounded evidence loop | Route only relevant source roles, assess gaps and allow one follow-up retrieval round. Missing farm facts and unavailable integrations produce different replies. Scope/freshness/citations constrain publication. | `backend/src/runtime.ts`, `backend/test/evidence-loop.test.ts` |
| Rain advice uses likely/possible/unlikely and explicit forecast gaps | Keep percentages in source evidence. Farmer reply, speech and replay use matching plain-language text; a forecast alone creates no farm task. | `backend/src/weather-copy.ts`, weather tests, `AGENTS.md` |
| **Calendar** replaces **This Week** | Exact typed future requests can save directly with Undo. Spoken or interpreted timing requires dated preview and Save; conflicts/past times clarify. Events record intent separately from evidence-backed approved work. Dates use Asia/Kolkata. | Approved language/calendar plan; `backend/src/calendar.ts`, `backend/test/calendar.test.ts`, current iOS views |
| Additional languages are disabled pilots | Kannada, Malayalam and Telugu require native review of UI, weather wording, spoken dates and calendar confirmations. Telugu listening covers Andhra Pradesh and Telangana. | Latest approved plan; `KALANI_PILOT_LANGUAGES`, pilot strings |
| Back up state and private audio together; inspect before resuming | Admin backup holds the writer lease, produces a consistent SQLite snapshot, verifies referenced audio and stores token hashes. There is no restore CLI. Tokens/configuration/client state require separate private transfer. | `backend/src/admin.ts`, backup/restore tests; [Mac procedure](MAC_TRANSFER.md) |

Pi 1.5.2 lacks the newer `defineSignal`/`harness.signal` APIs shown on upstream main. The implementation uses a committed decision inbox and durable timer wakeups, normally within 30 seconds, without holding an active model request. Upgrade only with recovery/version-compatibility verification.

## Evidence ledger

| Record | What it establishes | Limit |
| --- | --- | --- |
| Codex chat **Review the problem statement**, ID `01a1e8a2-623e-7a20-a467-d36b8b018bfe`, 17–20 November 2026 | Original problem exploration, approved implementation decisions, corrections and later test requests | Historical proposals and agent reports are not universal acceptance; use current files and run evidence. Archive is read-only provenance. |
| Same chat, approved **Kalani language switching and smart calendar** plan; latest request **Do a test and Check everything is Working?** | Explicit authorization for bilingual manual/spoken switching, Calendar semantics and acceptance checks | Prerecorded Simulator verification does not establish live microphone or human listening success. |
| Codex chat **Plan a shareable project pitch deck**, ID `01a1ede1-f629-7980-9b41-fad90eee8579`, 18 November 2026 | Approved 10-slide deck; later naming, bilingual, English-default and cross-platform corrections | Earlier Tamil-only title/screens and original test counts were superseded. Public/editable accounts do not migrate with source. |
| `pitch-deck/README.md`, static assets and JSON, 18 November | Actual bilingual Simulator captures, public deck, browser QA and historical 53-test evidence | Screenshots predate Calendar and later weather/language changes; they are dated presentation evidence. |
| `docs/verification/IMPLEMENTATION_STATUS.md`, 18–20 November | Progression from 54 to 79, 92 and 99 passing backend tests; signed Simulator fixture checks | Individual failed/interrupted checks remain failures in history. Audio state/identical bytes are not audible-human validation. |
| Fresh export checks and encrypted export inventory | Exact source revision, artifact hashes, snapshot contents and transfer validation | Use the actual export manifest for counts/paths; this ledger does not invent absent recordings, secrets or results. |

The encrypted `archive/` preserves available earlier runtime files and the presentation's separate Git history. Selected older evidence is kept under `evidence/`. Raw Codex chat transcripts are not exported; this reviewed ledger carries their decisions without copying credentials or account history. The archive may contain private paths or farmer/session material; do not publish it. If a record is absent, rely on the cited repository evidence and mark the historical question unresolved. Do not require access to the original Codex account to continue source development.

## Remaining acceptance

- Human microphone and audible first-play/replay verification, including the earlier extra-word/Tamil-replay observations; native English/Tamil comprehension and real farmer usefulness.
- Native review before enabling language pilots; physical-device behavior, permissions/recovery and representative audio checks.
- Reviewed crop/opportunity catalogues and market mapping/units. Configured adapters and synthetic tests do not prove current applicable guidance.
- Production APNs/WhatsApp delivery, hosted operation, Android and farmer-facing web. Local Simulator notifications and active-app SSE do not establish background delivery.
- Retention/purge policy covering immutable Pi history, backups and providers. Current deletion is not complete erasure of historical records.
