# Multi Agent Farm Operations Orchestrator PRD

Version 0.5 — 17 November 2026. Status: approved Pi Durable architecture; implementation and validation in progress. Audience: product, engineering, design, agricultural reviewers and event evaluators. Product behaviour is specified in [PRODUCT_SPECIFICATIONS.md](PRODUCT_SPECIFICATIONS.md).

## 1. Product purpose and problem

Help a farmer decide what deserves attention next by connecting their field conditions, current weather, agricultural guidance, market observations and relevant government opportunities. Deliver that help through a Tamil audio conversation and timely updates, with minimal routine app use.

The farmer describes their situation once, corrects misunderstandings and supplies occasional observations. Cooperating specialist agents build a weekly plan, explain their evidence, identify missing information and adapt the plan as circumstances change. A private history and reusable playbooks reduce repeated questions and make later guidance more relevant.

The user has identified reluctance to adopt another app, differences in literacy and phone familiarity, and the importance of local languages as design concerns. These are product hypotheses and constraints, not completed field research. Validate the underlying reasons for reluctance rather than assume all farmers have the same needs.

Working problem statement:

> How can a farmer receive and understand useful, timely guidance in their own language, act with control, and build practical knowledge without repeatedly searching for information or navigating a complex app?

Profit improvement is an intended long-term outcome, not a guaranteed feature or established result. The first release must demonstrate trustworthy guidance, usability, relevance and farmer control before claiming agronomic or financial impact.

## 2. Users and intended outcomes

| User or role | Need | Successful experience |
| --- | --- | --- |
| Primary: Tamil-speaking farmer | Understand priorities, changing conditions, market information and opportunities without extensive reading | Describes a field, hears useful guidance, corrects errors, asks why and decides what to do |
| Farmer with limited phone familiarity | Complete the same journey with clear choices and recoverable mistakes | Uses voice or choices independently; optional assistance does not become a prerequisite |
| Trusted friend, neighbour or local helper | Help the farmer get started when requested | Assists navigation while the farmer retains their own profile, preferences and decisions |
| Agricultural/content reviewer | Check applicability, source quality and cases requiring expertise | Can inspect evidence, review status, source dates and reasoning summaries |
| Event evaluator | Assess five farm profiles, agent cooperation and appropriate refusal | Can inspect a working journey, architecture, one plan trace and refusal cases |

Pilot participants, crops and locations will follow the event profiles and farmer access; they are not yet selected. Tamil is a language decision, not proof that every profile is located in Tamil Nadu. Government and agricultural sources must be matched to the actual location.

The farmer should be able to answer: What is this information? Why does it matter to my crop? How old is it? What is still unknown? What am I being asked to approve?

## 3. Agreed scope and boundaries

### First release

- Tamil audio messages, spoken responses, replay, Tamil text alternatives and contextual choices. Recognise local terms and mixed-language speech where supported; clarify uncertainty.
- Farmer-led, concern-first onboarding. Provide initial useful information after village and crop are confirmed; enrich the profile progressively.
- Today as the ordinary return experience: relevant audio guidance with listen and reply actions. Preserve conversation history, weekly activities and editable farm information.
- A source-backed seven-day work plan, with task-level approval, correction and completion reporting.
- Weather-aware guidance, relevant crop guidance, dated market comparisons and harvest/selling preparation.
- Official government opportunity discovery, relevance screening, explanation, application handoff and verified-deadline reminders.
- Private farmer playbooks and reported outcomes, checked against current circumstances before reuse.
- Relevant notifications and an in-app calendar, guided by farmer preferences.
- Short optional explanations that improve crop, market and weather understanding.
- Evidence records, structured agent contributions and appropriate clarification, refusal or expert-help responses.

### Later or excluded from this release

- WhatsApp calling and other automated phone calls; other delivery channels require a later integration decision.
- Additional farmer-facing languages and untested dialect-specific speech generation.
- Our own price/yield forecasts before historical validation. Using current external weather forecasts is included now.
- Automatic purchases, equipment control, benefit applications, financial transactions or other external operational actions.
- Unsupported disease diagnosis, invented chemical doses or indiscriminate reuse of archived treatments.
- Automatic model retraining, sharing private playbooks across farmers, guaranteed profits or promised yield increases.
- A nationwide scheme catalogue, real-time market coverage or offline AI reasoning claimed without evidence.

The first demonstration will run as an iPhone app in iPhone Simulator through Xcode, as selected by the user. This settles the demonstration environment, not which phones real farmers will use or the eventual Android/iOS rollout. Simulator demonstration and field-pilot validation are separate gates.

Native SwiftUI is selected for the iPhone demo. Keep agent orchestration, source retrieval, private playbook persistence and speech-service credentials behind backend interfaces so a later Android client can reuse those capabilities. This does not imply shared iOS/Android UI code.

UI composition, final wording, branding and visual design remain deferred. Existing storyboards are exploratory. The approved application architecture is a native SwiftUI client and one TypeScript backend embedding Pi Durable, connected to Claude through Pi’s Anthropic provider. Pi application documents and checkpointed tasks use its SQLite adapter; audio stays in private backend files. This supersedes the earlier FastAPI/Python SDK/PostgreSQL proposal. Production hosting, account recovery, farmer-device rollout and production push delivery remain open.

Persistent learning means confirmed memory, dated reported experience and reviewed playbooks, plus evaluated improvement proposals. The service must not rewrite deployed prompts, tools or agricultural rules automatically. A named reviewer and passing held-out farm and Tamil comprehension evaluations are required to approve an improvement candidate; activating it in production remains a separately reviewed configuration/code change. Sarvam is the first Tamil speech adapter, subject to account access and comprehension evaluation.

Pi packages are pinned to published version 1.5.2. The installed release has durable timers but no signal API: farmer decisions are committed to a version-bound inbox and picked up by a sleeping durable task within 30 seconds, without an active model call. Package upgrades must pass recovery and compatibility checks before adoption. See the authoritative architecture in the product specification.

## 4. Product requirements

All requirements below are required for the intended first release. The sequence of implementation is separate from product scope.

| ID | Requirement | User-visible acceptance |
| --- | --- | --- |
| FR-01 | Tamil communication | Farmer can hear assistant messages, send audio, replay messages and use Tamil choices/text; English-only fallbacks are not silently substituted |
| FR-02 | Accessible progressive onboarding | Ask the immediate concern, confirm village/crop and provide supported early value; unknown soil/date details do not block unrelated information |
| FR-03 | Confirmation and correction | Read back consequential facts; preserve estimates as estimates; a correction changes dependent guidance and cancels obsolete reminders |
| FR-04 | Today and conversation continuity | Ordinary return opens relevant audio with reply; notifications open the referenced item; history and incomplete onboarding are recoverable |
| FR-05 | Weekly operations plan | Provide dated, evidence-backed priorities and relevant questions for one farm; separate fields/crop cycles where applicable |
| FR-06 | Weather and crop guidance | Relate current evidence to farmer observations without presenting modelled data as measured field truth or inventing agronomic advice |
| FR-07 | Harvest and market support | Compare applicable dated observations and feasible options; explain units, missing costs/grade and limits; no guaranteed selling price |
| FR-08 | Government opportunities | Explain why a verified-source candidate may be relevant, what remains unknown and the official next step; no invented eligibility or deadlines |
| FR-09 | Farmer playbooks | Save private context, practices and reported outcomes; reuse only after applicability/source checks and retain provenance |
| FR-10 | Notifications and calendar | Send opted-in relevant updates and maintain dated activities; deduplicate, respect preferences and retire superseded events |
| FR-11 | Learning and agricultural mapping | Connect field/crop/stage/water/soil/weather/market evidence; provide short optional explanations and appropriate next-season context |
| FR-12 | Evidence and cooperation | Every recommendation has claim-supporting evidence; specialist outputs contribute to a reconciled plan with an inspectable agent trace |
| FR-13 | Farmer control and refusal | Confirmation, approval, delivery and completion remain distinct; insufficient or unsafe requests produce clarification, refusal or help |
| FR-14 | Recovery and privacy | Recover from recording/network/source failures; keep farmer data isolated and provide correction, export and deletion mechanisms |

### Required journeys

1. **Get started:** choose Tamil, understand the service, state a concern, confirm village/crop, receive supported information and answer further relevant questions.
2. **Plan work:** discuss pending work and constraints, hear proposed priorities, ask why, approve a specific task or request changes.
3. **Correct the system:** identify a misheard crop/location/date, confirm the replacement, hear what changed and review affected tasks again.
4. **Prepare to sell:** establish harvest context and reachable markets, hear dated comparisons, add missing costs if desired and assess options.
5. **Explore support:** hear a potentially relevant official opportunity, check conditions, choose whether to follow the official application route or save a verified reminder.
6. **Return and learn:** hear a relevant update, report completed/postponed work, save useful context and receive a better-informed subsequent plan.

No journey should require a farmer to understand agent architecture, prompts, source APIs or database concepts.

## 5. Data and trust principles

Sources supply evidence; farmer observations supply operational context. Neither a citation nor an official publisher makes an old or mismatched recommendation applicable to the current field.

- Retain publication/observation date, retrieval time, scope and supporting source location. “Fetched today” must not become “observed today.”
- Identify measured, farmer-reported, modelled and inferred information separately. Confirm consequential facts before using them for field-specific advice.
- Market prices are dated observations, not a buyer's offer or forecast. Scheme announcements are discovery leads, not proof that applications are open.
- Personalisation improves retrieval, questions and relevant reuse. An outcome reported after an action does not prove causation or validate an agricultural recipe.
- Explain material uncertainty in Tamil. When information is absent, ask a precise question or state a useful limit; never fabricate completeness.
- Keep recordings and private farm knowledge isolated. External content cannot instruct agents to ignore controls, reveal another farmer's information or approve a task.

Source feasibility and access limits are recorded in the product specification. Commercial permissions, actual API access, content reuse rights and operational coverage require verification before deployment.

## 6. Success measures and release evidence

The following are proposed pilot evaluation measures, not measured results or launch promises. Sample sizes are initial discovery gates, not statistical proof of nationwide usefulness.

| Measure | Evaluation method | Initial criterion |
| --- | --- | --- |
| Independent use | Observe first-use, correction, replay and a task decision | At least four of five pilot participants complete the journey after the welcome without helper intervention; record every failure |
| Comprehension | Ask the farmer to explain a task, its reason and the decision made | Document whether the meaning matches the recommendation and whether approval/completion are distinguished |
| Tamil speech | At least 30 consented short clips, six speakers and three regional speech varieties, including local terms and noise | Assess transcription of consequential facts and native-speaker intelligibility; unresolved facts must trigger confirmation |
| Early value | Measure steps and time to first supported response after village/crop confirmation | Demonstrate no irrelevant full-profile gate; set a latency target after device/provider measurements |
| Evidence fidelity | Review every recommendation in the five-profile demonstration | Supporting content must match the actual claim, crop, location, time and units; failures block sign-off |
| Safe decisions | Test unsupported/unsafe requests and ambiguous inputs | No invented dose, false eligibility, fabricated deadline or silent approval in the agreed evaluation set |
| Notification quality | Test retries, expired sources, corrections, quiet periods and disabled notifications | No duplicate or obsolete dispatch in the tested scenarios; distinguish provider acceptance from receipt |
| Useful personalisation | Compare repeat visits and playbook reuse | Track repeated questions, irrelevant messages and reported usefulness without interpreting them as yield/profit evidence |
| Operational feasibility | Measure service usage, latency, failure recovery and cost | Set budgets from representative audio, source and device trials before pilot sign-off |

Completion evidence for the event includes the five supplied profiles, architecture diagram, one source-linked agent log for a plan and a list of correct refusal cases. Synthetic profiles may support development but must not be represented as event profiles or real farmers.

## 7. Delivery dependencies and open decisions

Sequence the work as: establish Pi/Claude/custom-tool/SQLite restart feasibility; implement isolated farm state and versioned decisions; integrate real sources and bounded specialists; add reviewed learning and durable delivery; integrate the SwiftUI Tamil audio journey and validate the complete event demonstration. This is a dependency order, not a quoted timeline or staffing commitment.

| Decision/dependency | Required resolution |
| --- | --- |
| Demonstration target | Confirmed: native SwiftUI app in iPhone Simulator via Xcode. Xcode 27.2 and available iPhone simulator devices/runtimes were verified on 17 November 2026; record the exact build/device/runtime and observed launch outcome in the implementation verification report |
| Production client platform | Farmer devices and Android/iOS rollout remain open; do not infer them from the simulator demo choice |
| Final UI and Tamil copy | Revisit the exploratory screens during stack discussion; native-speaker and farmer validation remain required |
| Speech and reasoning services | Evaluate Tamil/domain accuracy, code-mixing, latency, costs and account access; provision credentials securely |
| Identity and shared-phone use | Decide authentication/recovery with low onboarding burden and private profile isolation |
| Profiles, crops and geography | Obtain event profiles and pilot farmer access; restrict claims to covered contexts |
| Source access and maintenance | Validate real responses, source freshness, permission/terms and responsibility for reviewed scheme/advisory updates |
| Review responsibility | Assign agricultural and scheme-content review before live recommendations; no named reviewer is appointed yet |
| Policy and service budgets | Confirm retention, notification timing, freshness thresholds, recording limits, supported devices and latency/cost targets |
| Forecasts and expansion | Revisit only after the relevant historical, language or channel evaluation succeeds |

The first release is not complete merely because screens render or automated tests pass. Completion requires evidence for the product journeys, source fidelity, language comprehension and operational limits above.

For the simulator demo, distinguish actual recording, synthesis, backend/source access and notification handling from any labelled samples or simulated events. A staged notification can demonstrate navigation but cannot establish end-to-end delivery to farmers' phones. Validate audio, permissions, connectivity and delivery on representative physical devices before a field pilot.
