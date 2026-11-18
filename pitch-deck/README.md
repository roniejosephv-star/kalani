# Kalani: A Farmer's Assistant pitch deck

Ten slides, five minutes. English narration with actual Tamil iPhone Simulator screens.

- Public browser deck: https://tamil-farm-assistant-pitch.tawnyforge4.chatgpt.site
- Editable ChatGPT presentation: `artifact_Qg5XM1IyngdbQurtm-r7ptGEFFcMl6lo`
- Shared content and speaker notes: `dist/deck.json`
- Browser renderer: `dist/index.html`, `dist/styles.css`, `dist/app.js`
- Editable presentation authoring callback: `author-presentation.mjs`

Only `dist/` is served. The browser deck has no backend or external dependencies. Run `python3 -m http.server 8791 --bind 127.0.0.1 --directory dist` from this folder for local preview. Use the arrow keys, Previous/Next, slide links or Home/End. Presenter notes and implementation references expand below each slide.

## Evidence and provenance

The four JPEGs in `dist/assets/` are unaltered captures from the existing running FarmAssistant app on iPhone 17 Pro / iOS 26.2 Simulator, captured on 18 November 2026. The farm profile is synthetic. Conversation shows unavailable-service/retry states and This Week has no tasks. The deck does not represent these as live accepted guidance. No generated storyboard is used.

Verification on 18 November 2026: `npm run check` in `backend/` compiled TypeScript and passed 44 tests. The remaining HTTP test could not bind a loopback socket in the sandbox. `node --import tsx --test test/http.test.ts` passed separately with loopback access. Thus all 45 tests have passing results across these two runs. Providers are synthetic in the tests. No live provider calls, farm validation or new native build were performed for this deck.

Browser QA checked all ten slides at 1440×1000 and 390×844, image loading, no horizontal/slide overflow, navigation buttons, keyboard navigation, direct hash links and presenter notes. Browser plugin was not available, so the bundled Playwright runtime performed these checks. All slides in the editable presentation were rendered and visually reviewed. A separate source review found no material factual issues.

After content changes, update both the live presentation and browser rendering from the same JSON, rerender affected slides and repeat affected browser checks. Preserve built-versus-unverified distinctions. Application source and provider configuration are outside this presentation's scope.
