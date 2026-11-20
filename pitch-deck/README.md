# Kalani: A Farmer's Assistant pitch deck

Ten slides, five minutes. English pitch with actual English app screens and a two-screen English/Tamil language-switch comparison.

- Public browser deck: https://tamil-farm-assistant-pitch.tawnyforge4.chatgpt.site
- Editable ChatGPT presentation: `artifact_Qg5XM1IyngdbQurtm-r7ptGEFFcMl6lo`
- Shared content and speaker notes: `dist/deck.json`
- Browser renderer: `dist/index.html`, `dist/styles.css`, `dist/app.js`
- Editable presentation authoring callback: `author-presentation.mjs`

Only `dist/` is served. The browser deck has no backend or external dependencies. Run `python3 -m http.server 8791 --bind 127.0.0.1 --directory dist` from this folder for local preview. Use the arrow keys, Previous/Next, slide links or Home/End. Presenter notes and implementation references expand below each slide.

## Product direction and invigilator walkthrough

Kalani targets iOS, Android and web. The current working client is the iPhone Simulator demo; Android and farmer-facing web clients are planned. The public Site is the pitch presentation.

The deck maps an illustrative concern, “Will rain affect this week's work?”, to Conversation → My Farm confirmation → Today reply/source/replay → a supported This Week task decision → corrected context and return. Missing evidence produces a clarification; task decisions depend on a valid task. Slide 7 gives the observer a screen-by-screen usability checklist. This is a demonstration plan, not a claim of completed farmer research.

Two primary regional studies ground the information need:

- Kumbhare et al., Assessment of Utility of Mobile Based Agro-advisory Services in NCR Delhi: https://epubs.icar.org.in/index.php/IJEE/article/view/108214 . Study in four villages in 2017, issue labelled 2019, webpage published December 2020. Supports understandable messages with familiar words and local applicability.
- Chandra et al., Information and Communication Technology for Dissemination of Agricultural Information in Hills, 2018: https://epubs.icar.org.in/index.php/IJEE/article/view/143879 . Almora research supports weather, farm advice and market information needs. No nationwide extrapolation or Kalani outcome claim is made.

Repository references in `dist/deck.json` are relative to the repository root. Product requirements are in [PRD.md](../docs/product/PRD.md), the HTTP contract is in [API_CONTRACT.md](../docs/architecture/API_CONTRACT.md), and current verification limits are in [IMPLEMENTATION_STATUS.md](../docs/verification/IMPLEMENTATION_STATUS.md).

## Evidence and provenance

The three JPEGs in `dist/assets/` are unaltered captures from the current Kalani bilingual build on iPhone 17 Pro Max / iOS 26.2 Simulator, captured on 18 November 2026. An isolated Simulator was used because another test was controlling the original device. The profile is explicitly synthetic. Today shows the genuine English interface and its empty guidance state. An older farmer message retains its original language. The two My Farm captures show the same selector with English and Tamil selected in turn. The evaluation session was returned to English, and English navigation persisted after terminating and relaunching the app. Fresh installations retain the app's explicit language chooser. No global language fallback or application source was changed.

Verification on 18 November 2026: `npm run check` in `backend/` compiled TypeScript and passed 52 of 53 tests. The remaining HTTP test could not bind a loopback socket in the sandbox. `node --import tsx --test test/http.test.ts` passed separately with loopback access. All 53 tests therefore have passing results across those runs. Providers are synthetic in these tests. Language-switch regression coverage includes keeping an in-flight English message in English after the preference changes to Tamil. This does not establish live pronunciation, comprehension or agricultural impact.

A temporary screenshot UI test in `/private/tmp/kalani-pitch-capture/` captured an English screen but was externally killed while another Simulator test ran. That run is not counted as a passing test. The final published captures and language persistence check used the native controls on the isolated Simulator. No AI questions were sent for these captures.

Browser QA checked all ten slides at 1440×1000 and 390×844, image loading, no horizontal/slide overflow, navigation buttons, keyboard navigation, direct hash links and presenter notes. Browser plugin was not available, so the bundled Playwright runtime performed these checks. All slides in the editable presentation were rendered and visually reviewed. A separate source review found no material factual issues.

After content changes, update both the live presentation and browser rendering from the same JSON, rerender affected slides and repeat affected browser checks. Preserve built-versus-unverified distinctions. Application source and provider configuration are outside this presentation's scope.
