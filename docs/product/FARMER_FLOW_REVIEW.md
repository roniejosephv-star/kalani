# Tamil farmer screens and conversation review

Status: interaction brief for review, not an implemented interface. Tamil strings are draft standard conversational Tamil and require native-speaker and farmer review before release. This brief follows [BLUEPRINT.md](../architecture/BLUEPRINT.md); WhatsApp calls and price/yield prediction remain outside the first build.

UI refinement is deferred until the implementation-stack discussion. Use [PRD.md](PRD.md) and [PRODUCT_SPECIFICATIONS.md](PRODUCT_SPECIFICATIONS.md) as the current product requirements; this screen brief and its storyboard are exploratory references, not approval of final layouts or styling.

Visual composition reference: [Tamil welcome, crop confirmation and Today](../design/tamil-farmer-storyboard.png). This generated image shows three selected states, not the entire onboarding sequence. [Prompt and review limitations](../design/STORYBOARD_PROMPT.md) preserve its provenance. It is not a functioning interface or an approved visual system.

## 1. Experience and screen sequence

The farmer opens the app, hears how it helps, describes a field, confirms what was understood and receives a useful next step. They then return through notifications or open the same conversation whenever needed. The primary task is talking and choosing; typing, reading long passages and navigating dashboards are optional.

Use the familiar message-thread pattern requested by the user. Each assistant turn has matching Tamil text and audio, a labelled replay button and at most three or four relevant choices. One recorder remains in a consistent position. Keep assistance available without making a helper part of the normal path. Use the farmer's confirmed vocabulary; do not force a dialect category during onboarding.

### Screen 1: Welcome in Tamil

Show Tamil in its own script, a short listenable introduction and one prominent continue action. Tamil is the only enabled language initially; do not display an intimidating list of unsupported languages. Keep language settings discoverable so future languages can be added without redesigning onboarding.

- Heading: “வணக்கம்” — Hello.
- Primary choice: “தமிழில் தொடரவும்” — Continue in Tamil.
- Listen control: “கேட்கவும்” — Listen.
- Spoken introduction: “உங்கள் பயிர், வானிலை, சந்தை பற்றிய தகவல்களைத் தமிழில் தெரிந்துகொள்ளலாம். பேசிப் பதில் சொல்லலாம்.” — You can learn about your crop, weather and market in Tamil. You can answer by speaking.
- Briefly identify the assistant as automated before collecting information. Do not imply it is a government officer or a human agronomist.

Avoid first-screen account forms, bank details, land-document requests, push permission prompts or a demand for precise location. Any identity setup needed to retain the profile must explain its purpose and preserve progress; authentication method is an implementation decision to settle before building.

### Screen 2: Explain voice and request microphone access

Explain why microphone access is useful, then request it only when the farmer chooses to record. Provide typed/choice-based participation if permission is denied. Explain audio processing in a short Tamil message with further detail available on request.

- Prompt: “நீங்கள் பேசிப் பதில் சொல்லலாம். ஒலிப்பதிவை அனுப்பும் முன் கேட்டுப் பார்க்கலாம்.” — You can answer by speaking. You can listen to your recording before sending it.
- Primary choice: “பேசிப் பதில் சொல்லவும்” — Answer by speaking.
- Alternative: “தேர்வு செய்து பதில் சொல்லவும்” — Answer using choices.

Listening to assistant audio must work without granting microphone access. Do not automatically begin recording when permission is granted.

### Screen 3: One conversation for farm setup

This is one screen with successive questions, not a separate page or large form for each field. First ask what help the farmer wants: weekly work, a crop concern or selling. Then collect the relevant facts from village, crop, sowing/transplanting date or approximate stage, known soil information and irrigated/rain-fed status. A market comparison must not depend on completing soil questions. Ask for water/labour/selling constraints only when relevant. Display progress as “next question” rather than a false fixed percentage when clarification may add turns.

Offer “தெரியவில்லை” — I don't know — wherever a farmer may lack the requested detail. An unknown date or soil type remains unknown. Do not convert an approximate month into a precise day. Ask about one field/crop cycle at a time and allow another to be added later.

Once village and crop are confirmed, show the first useful information supported by available evidence. Do not gate that response on a complete profile. Clearly dated market observations or relevant forecast information may be shown early; a crop-stage action or field-specific recommendation still waits for the information it requires. Save incomplete profile fields as unknown and ask about them progressively.

### Screen 4: Confirm and correct

Read back important facts in short groups as they are collected. This is a confirmation state within Conversation, not a mandatory all-fields review page. Use a spoken summary and separate correction choices rather than a long table the farmer must inspect. Highlight an uncertain crop name, date or unit and ask for confirmation before it drives a recommendation.

- Heading: “நான் சரியாகப் புரிந்துகொண்டேனா?” — Did I understand correctly?
- Choices: “விவரங்கள் சரி” — The details are correct; “திருத்த வேண்டும்” — A correction is needed; “மீண்டும் கேட்கவும்” — Listen again.

The details-confirmation action confirms farm information only. Do not carry it forward as approval of any task, scheme application or future action. After correction, read the changed detail back and retain an edit route later in My Farm.

### Screen 5: First useful response

Continue with the concern chosen at the start of the conversation; do not ask the same question again. Generate a source-backed response when possible, with a precise question when evidence is insufficient. A response may be useful without proposing an agricultural intervention: identifying needed field information or showing a clearly dated market observation is valid.

Show what matters next, the reason and supporting source/date. Use small audio segments with matching messages. Keep full agent logs out of the farmer's default view; “why?” opens the relevant plain-language explanation and source.

- Choices: “ஏன்?” — Why?; “கேள்வி கேட்கவும்” — Ask a question; “பின்னர் பார்க்கவும்” — View later.
- When a task is ready: read the specific task and date, then ask “இந்தப் பணியைச் செய்ய ஒப்புக்கொள்கிறீர்களா?” — Do you agree to do this task?
- Choices: “செய்ய ஒப்புக்கொள்கிறேன்” — I agree to do it; “மாற்றவும்” — Change; “இப்போது வேண்டாம்” — Not now.

Do not put multiple task approvals behind one ambiguous confirmation. If new evidence changes a task, explain the change and request approval of that version.

### Screen 6: Choose when to receive updates

Ask after the farmer has received something useful. Explain that an update can be listened to later and that preferences can change.

- Prompt: “தகவல்களை எப்போது பெற விரும்புகிறீர்கள்?” — When would you like updates?
- Choices: “காலையில்” — In the morning; “மாலையில்” — In the evening; “இப்போது வேண்டாம்” — Not now.

Explain the selected delivery time before requesting system notification permission. Declining permission must still finish onboarding. Keep updates in the app. Never announce successful device delivery simply because the app scheduled an event.

### Screen 7: Return from an update

A notification opens the exact audio message or task, not a generic dashboard. Explain what changed and whether a previous recommendation was replaced. Offer reply, explanation or the relevant decision. Do not play audio automatically from the notification or on a locked device.

For a completed task, allow “செய்துவிட்டேன்” — Done. For a task the farmer could not complete, allow “செய்ய முடியவில்லை” — Could not do it. Ask a follow-up only if it improves the next recommendation. Avoid guilt, streaks or repeated demands for responses.

### Screen 8: Today, My Week and My Farm

Use three primary destinations with labels that can be listened to: Today, My Week and My Farm. Draft Tamil: “இன்று”, “இந்த வாரம்”, “என் பண்ணை”. Validate whether farmers prefer a local equivalent of “farm/field” instead of imposing one term.

Normal return visits open Today. Present the latest relevant audio update with a large labelled listen action and a reply control immediately below it. Bring any decision needed for that update into the same view. Keep earlier conversation one action away rather than making the farmer scroll through onboarding to reach the newest information.

Today hierarchy: greeting and local date; latest relevant audio update with its source/validity date; listen/replay action; one relevant question or decision; reply by voice or choices; remaining updates if any; navigation. If nothing new exists, say so and offer a question or the saved weekly plan. Do not fabricate a fresh message to fill the screen, label an old source as today's observation, or show expired guidance as current.

My Week shows the next few relevant activities, completed work and verified opportunity deadlines. My Farm contains editable details, additional fields/crop cycles, saved playbooks and update preferences. Government opportunities and market information stay reachable from Today, the conversation and relevant weekly items; avoid additional top-level tabs in v1.

## 2. Example Tamil conversation

Synthetic wording example only. It does not establish a real farmer profile, weather forecast, market observation, scheme eligibility or agricultural recommendation.

| Turn | Draft Tamil | Meaning and behaviour |
| --- | --- | --- |
| Assistant | “உங்கள் வயல் எந்த ஊரில் இருக்கிறது?” | Which village is your field in? Confirm ambiguous place names; offer location sharing as optional help. |
| Assistant | “இப்போது என்ன பயிர் சாகுபடி செய்கிறீர்கள்?” | What crop are you growing now? Voice answer or locally relevant crop choices; include another crop. |
| Farmer | “நெல்.” | Paddy/rice crop. Keep the farmer's term alongside the confirmed crop identity. |
| Assistant correction example | “நீங்கள் நெல் என்று சொன்னீர்களா, எள் என்று சொன்னீர்களா?” | Did you say paddy or sesame? Ask only when this ambiguity actually exists; never pretend recognition succeeded. |
| Farmer | “நெல்.” | Confirmation resolves the ambiguity; no downstream recommendation uses the earlier uncertain transcript. |
| Assistant | “விதைத்தீர்களா, நாற்று நட்டீர்களா?” | Did you sow directly or transplant seedlings? Establish which event a later date refers to. |
| Assistant | “எப்போது நாற்று நட்டீர்கள்? சரியான தேதி தெரியாவிட்டால், ஏறக்குறைய எப்போது என்று சொல்லலாம்.” | When did you transplant? An approximate answer is allowed. Adapt the wording for direct sowing. |
| Assistant | “உங்கள் வயலில் என்ன மண் வகை என்று தெரியுமா?” | Do you know the soil type? Offer unknown and do not infer field soil from village alone. |
| Assistant | “வயலுக்கு நீர் எப்படி கிடைக்கிறது?” | How does the field get water? Clarify mixed irrigation/rainfall rather than force a false binary. |
| Assistant | “இந்த வாரம் என்ன வேலை செய்ய நினைக்கிறீர்கள்?” | What work are you considering this week? Ask relevant constraints progressively. |
| Assistant | “நான் சொன்னதில் ஏதாவது தவறு இருந்தால் திருத்திச் சொல்லுங்கள்.” | Please correct anything I understood incorrectly. Read back consequential facts before using them. |
| Assistant when evidence is missing | “இதற்கான தகவல் இப்போது என்னிடம் இல்லை. ஒரு விஷயத்தை உறுதிப்படுத்திக்கொள்ளலாமா?” | I do not have the needed information now. May I confirm one thing? Follow with a specific, answerable question. |

The final response uses actual retrieved evidence or explicitly reports missing data. Do not insert a sample rain probability, price, deadline or chemical dose into this conversation to make the demo appear complete.

## 3. Recorder and message behaviour

| State | Farmer sees or hears | Next action |
| --- | --- | --- |
| Ready | A labelled microphone action | Tap to start; no hold gesture required |
| Recording | Clear recording indicator and elapsed time | Tap stop; do not send automatically |
| Preview | Their own recording and clear send/discard controls | Listen, send or discard |
| Uploading/processing | A simple Tamil progress message | Preserve the draft and allow recovery; do not show a fabricated answer |
| Understood | Tamil transcript plus spoken read-back of consequential details | Confirm or correct |
| Unclear | Specific word/detail needing clarification | Voice response or a small set of alternatives |
| Assistant reply | Matching Tamil text/audio and relevant choices | Replay, reply, explain or decide |
| Failed | A recoverable message without losing the draft | Retry or continue through choices |

Draft action labels: “பதிவு செய்யவும்” (record), “பதிவை நிறுத்தவும்” (stop recording), “கேட்டுப் பார்க்கவும்” (preview/listen), “அனுப்பவும்” (send), “நீக்கவும்” (discard/delete) and “மீண்டும் முயற்சிக்கவும்” (retry). Test whether these labels are immediately understood; do not assume icons alone are sufficient. Discarding an unsent recording must not look like deleting the farm profile.

Stop the previous audio when another starts. Preserve visible playback state and provide pause/replay. Replaying must replay the same saved answer rather than generate new advice. If an answer is outdated, retain it in history with its date and offer the replacement; a historical approved task must not look current.

Label farmer recordings and assistant replies separately, using draft labels “உங்கள் பதிவு” (your recording) and “உதவியாளரின் பதில்” (assistant response). A sent recording, an unsent draft and a generated reply must remain visually distinguishable without relying on colour alone.

## 4. Market and opportunity message review

Market message order: crop/market and observation date, comparable units, what the comparison shows, missing costs/grade information, and a useful next question. Read out the source date and units with important numbers. “Latest available” must not be translated into “today” when the observation is older. No default instruction to sell or wait based only on a price trend.

Opportunity message order: the name/purpose in plain Tamil, why it may relate to this farmer, current availability status, what still needs checking, and the official next step. Ask before creating a personal reminder. An unknown deadline is not an invitation to invent one.

Illustrative opportunity wording: “இந்தத் திட்டம் உங்களுக்குப் பொருந்தக்கூடும். தகுதி விவரங்களையும் விண்ணப்பிக்கும் முறையையும் தெரிந்துகொள்ள விரும்புகிறீர்களா?” — This scheme may be relevant to you. Would you like to learn about eligibility and how to apply? Show this only for an actual source-linked candidate; it does not assert eligibility.

Keep agent implementation details out of these messages. Explain the evidence and its practical meaning. A farmer can ask for the source or additional help without navigating to a technical log.

## 5. Review decisions and comprehension checks

The proposed direction is an operational conversation: one question at a time, familiar audio messages, labelled choices, and a small weekly agenda. Visual branding, final typography and colour choices follow after this sequence is reviewed; no visual world has been selected or implemented.

Review with farmers who differ in reading confidence, phone familiarity and regional speech. Ask them to perform the actions rather than only ask whether they like the screen.

- Can they start a recording, stop it, listen and send without help?
- Can they recover after a misheard crop or a denied microphone permission?
- Can they distinguish confirming information, agreeing to a task and reporting completion?
- Can they replay an explanation and describe its meaning in their own words?
- Can they recognise an old market date and a scheme whose eligibility is not yet established?
- Can they decline notifications, finish onboarding and still find the plan later?
- Can they hear the first useful information without completing the entire profile, and find today's relevant audio on an ordinary return visit without searching chat history?
- Do the Tamil terms feel familiar, respectful and clear? Note local vocabulary, revise the glossary, and retest before claiming dialect support.

No native-speaker or farmer evaluation has been performed for this draft. Authentication, speech-provider benchmarking and the final visual design remain build-preparation decisions; they must not be treated as validated by this text review.
