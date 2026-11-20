# Project naming

- The app is named **Kalani**, with the subtitle **A Farmer's Assistant**. Use this name in pitch decks and product-facing copy rather than the earlier descriptive title "Tamil Farm Assistant".
- Preserve existing source filenames and technical identifiers unless renaming them is explicitly part of the task.
- Kalani supports **English and Tamil**, with a user-controlled language switch. Do not describe it as Tamil-only or use outdated Tamil-only screenshots as the primary usability evidence.
- In farmer-facing weather replies and audio, say when rain is likely, possible, or unlikely in plain English or Tamil. Show forecast gaps clearly, keep raw rain percentages in source evidence, and use the same text for speech and replay.
- Present the pitch and invigilator demonstration in **English by default**. Include two actual screens showing the English/Tamil language switch, and leave the evaluation session in English.
- Kalani's product direction includes **iOS, Android and web**. The current working demonstration is on iPhone Simulator; label Android and web clients as planned until they are built and verified.
- Lead the pitch with a concrete farmer pain point and map it to the user actions, visible screens and usability checks an invigilator can follow. Distinguish illustrative scenarios from completed farmer research.

# Project attribution

- Kalani was created by **roniejosephv-star**. Do not infer project authorship from the account used to access development tools.
- Credit contributors and co-authors only for actual work on Kalani; borrowing a development-tool account does not make its owner a contributor.
- Use `roniejosephv-star` for this repository's Git author and committer identity. Keep this configuration local to this repository; do not change the global Git identity.

# Development and transfer

- Start a continued session with `docs/handoff/CONTINUE.md`; follow `docs/handoff/MAC_TRANSFER.md` when moving to another Mac.
- Use macOS-native commands. Plan complex tasks first, re-plan after failures, and use subagents for isolated research and reviews.
- Keep changes minimal and focused. Preserve existing technical filenames. Record user corrections in this file.
- Run the relevant existing checks after changes and investigate failures. Use `$cpu-memory-performance` for CPU/memory-sensitive work and validate performance claims with representative measurements.
- Squash-merge PRs, explain why in commit messages, and never force-push `main` without explicit approval. Use worktrees for parallel implementation when requested.
- Keep provider keys, session tokens, private recordings, databases, simulator application data, and transfer exports out of Git and public chat transcripts.
- Do not resume the transferred runtime on both Macs. Source and destination cutover rules are in the transfer guide.
