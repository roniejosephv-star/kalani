import SwiftUI

struct TodayView: View {
    @Environment(FarmStore.self) private var store
    @State private var composer: ComposerSheet?
    var body: some View {
        List {
            if !store.connected { Label(store.localized("இணைப்பு துண்டிக்கப்பட்டுள்ளது. மீண்டும் இணைக்கிறது…", "Connection lost. Reconnecting…"), systemImage: "wifi.slash").foregroundStyle(.secondary) }
            Section {
                Text(store.state?.facts["crop"]?.text ?? "").font(.headline)
                Text(store.state?.facts["village"]?.text ?? "").foregroundStyle(.secondary)
            }
            Section(store.localized("சமீபத்திய வழிகாட்டல்", "Latest guidance")) {
                if let message = store.state?.messages.last(where: { $0.role == "assistant" && $0.status != "superseded" }) {
                    MessageCard(message: message)
                } else {
                    Text(store.localized("இன்னும் புதிய வழிகாட்டல் இல்லை. இன்று உங்களுக்கு என்ன உதவி தேவை?", "No new guidance yet. What can I help with today?"))
                }
            }
            Section {
                Button { composer = ComposerSheet() } label: { Label(store.localized("பேசிப் பதில் சொல்லவும்", "Speak a reply"), systemImage: "mic.fill").font(.headline) }.accessibilityIdentifier("reply")
                ForEach([store.localized("என் பயிருக்கு இன்று என்ன கவனிக்க வேண்டும்?", "What should I check on my crop today?"), store.localized("இந்த வார வானிலை பற்றி சொல்லுங்கள்", "Tell me about this week's weather"), store.localized("சந்தை விலை பற்றி தெரிந்துகொள்ள வேண்டும்", "I'd like to know market prices"), store.localized("அரசு உதவிகள் பற்றி சொல்லுங்கள்", "Tell me about government support")], id: \.self) { question in
                    Button(question) {
                        if !store.draft.attempted && !store.draft.hasAudio { store.draft.text = question; store.saveDraft() }
                        composer = ComposerSheet()
                    }
                }
            }
            if let pending = store.state?.messages.last(where: { $0.role == "farmer" && ["queued", "processing", "failed"].contains($0.status) }) {
                Section(store.localized("உங்கள் செய்தி", "Your message")) { MessageCard(message: pending) }
            }
        }
        .navigationTitle(store.localized("இன்று", "Today"))
        .refreshable { await store.refresh() }
        .sheet(item: $composer) { _ in ComposerView() }
    }
}
struct ComposerSheet: Identifiable { let id = UUID() }

struct ConversationView: View {
    @Environment(FarmStore.self) private var store
    @State private var composer: ComposerSheet?
    var body: some View {
        List {
            if store.state?.messages.isEmpty != false { Text(store.localized("உங்கள் முதல் கேள்வியைப் பேசலாம் அல்லது எழுதலாம்.", "Speak or type your first question.")) }
            ForEach(store.state?.messages ?? []) { message in
                Section(message.role == "farmer" ? store.localized("நீங்கள்", "You") : "Kalani") { MessageCard(message: message) }
            }
        }
        .navigationTitle(store.localized("உரையாடல்", "Conversation"))
        .toolbar { Button { composer = ComposerSheet() } label: { Label(store.localized("பதில் சொல்லவும்", "Reply"), systemImage: "square.and.pencil") } }
        .refreshable { await store.refresh() }
        .sheet(item: $composer) { _ in ComposerView() }
    }
}

struct MessageCard: View {
    let message: FarmMessage
    @Environment(FarmStore.self) private var store
    @Environment(AudioController.self) private var audio
    @State private var loadingAudio = false
    @State private var retryRequestID = UUID().uuidString
    @State private var audioLoadFailed = false
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(store.dateLabel(message.createdAt)).font(.caption).foregroundStyle(.secondary)
            if !message.text.isEmpty { Text(message.text).textSelection(.enabled) }
            if message.status != "ready" { Text(store.statusLabel(message.status)).font(.caption).foregroundStyle(.secondary) }
            if let id = message.audioId {
                Button {
                    Task {
                        loadingAudio = true
                        audioLoadFailed = false
                        defer { loadingAudio = false }
                        do {
                            guard let client = store.client else { return }
                            let identity = store.sessionID
                            let data = try await client.data("/v1/audio/\(id)")
                            guard identity == store.sessionID else { return }
                            audio.play(data: data, id: id)
                        } catch { audioLoadFailed = true }
                    }
                } label: {
                    Label(audio.isPlaying && audio.playingID == id ? store.localized("நிறுத்தவும்", "Stop") : store.localized("கேட்கவும் / மீண்டும் கேட்கவும்", "Play / Replay"), systemImage: audio.isPlaying && audio.playingID == id ? "stop.fill" : "play.circle.fill")
                }
                .accessibilityIdentifier("\(message.role)-audio-\(message.id)")
                .accessibilityValue(audio.isPlaying && audio.playingID == id ? "playing" : "idle")
                .disabled(loadingAudio)
                if loadingAudio { ProgressView() }
            } else if message.role == "assistant", let status = message.audioStatus {
                Text(store.statusLabel(status)).font(.caption).foregroundStyle(.secondary)
                if ["failed", "unconfigured"].contains(status) {
                    Button(store.localized("ஒலியை மீண்டும் தயாரிக்கவும்", "Generate audio again")) {
                        Task { _ = await store.mutate("/v1/messages/\(message.id)/retry-audio", body: ["requestId": UUID().uuidString]) }
                    }.disabled(store.busy)
                }
            }
            if audioLoadFailed { Text(store.localized("ஒலியைப் பெற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.", "Couldn't load the audio. Try again.")).foregroundStyle(.red).font(.caption) }
            if let error = audio.error { Text(store.audioError(error)).foregroundStyle(.secondary).font(.caption) }
            if let error = message.error { Text(store.serviceError(error)).font(.caption).foregroundStyle(.secondary) }
            if message.role == "farmer" && message.status == "failed" {
                Button(store.localized("இந்தச் செய்தியை மீண்டும் முயற்சிக்கவும்", "Retry this message")) {
                    Task {
                        if await store.retryMessage(message.id, requestId: retryRequestID) { retryRequestID = UUID().uuidString }
                    }
                }.disabled(store.busy).accessibilityIdentifier("retryMessage")
            }
            if let id = message.calendarEntryId,
               let entry = store.state?.calendarEntries?.first(where: { $0.id == id }) {
                CalendarEntryCard(entry: entry, inCalendar: false)
            }
            EvidenceList(ids: message.evidenceIds ?? [])
        }
        .padding(.vertical, 6)
        .buttonStyle(.borderless)
        .onChange(of: message.id) { _, _ in retryRequestID = UUID().uuidString }
    }
}

struct CalendarEntryCard: View {
    let entry: CalendarEntry
    let inCalendar: Bool
    @Environment(FarmStore.self) private var store
    @State private var edit: CalendarTimeSelection?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if inCalendar {
                Text(entry.title.isEmpty ? store.localized("எதை நினைவூட்ட வேண்டும்?", "What should I remind you about?") : entry.title)
                    .font(.headline).accessibilityIdentifier("calendarEventTitle")
                if let dueAt = entry.dueAt {
                    Text(store.dateLabel(dueAt)).font(.caption).foregroundStyle(.secondary)
                }
            } else if entry.version > 1, entry.status != "cancelled", let dueAt = entry.dueAt {
                Text(store.dateLabel(dueAt)).font(.caption).foregroundStyle(.secondary)
            }
            switch entry.status {
            case "draft" where !entry.title.isEmpty:
                if entry.dueAt != nil {
                    action("save", store.localized("சேமிக்கவும்", "Save")).accessibilityIdentifier("calendarSave")
                }
                Button(store.localized("நேரத்தை மாற்றவும்", "Change time")) {
                    edit = CalendarTimeSelection(date: max(entry.date ?? .now, .now.addingTimeInterval(60)))
                }.accessibilityIdentifier("calendarChangeTime")
            case "saved" where entry.fieldId == store.state?.fieldId && entry.cycleId == store.state?.cycleId:
                if !inCalendar, let date = entry.date {
                    Label(store.localized("சேமிக்கப்பட்டது", "Saved"), systemImage: "checkmark.circle")
                        .font(.caption).foregroundStyle(.secondary)
                    Button(store.localized("நாள்காட்டியில் பார்க்கவும்", "Open calendar")) {
                        store.showCalendar(on: date)
                    }.accessibilityIdentifier("openCalendarEvent")
                }
                action("undo", store.localized("சேமித்ததை நீக்கவும்", "Undo")).accessibilityIdentifier("calendarUndo")
            case "cancelled":
                Text(store.localized("சேமித்தது நீக்கப்பட்டது", "Event removed")).font(.caption).foregroundStyle(.secondary)
            default: EmptyView()
            }
        }
        .buttonStyle(.borderless)
        .disabled(store.busy)
        .sheet(item: $edit) { selection in CalendarTimeEditor(entry: entry, date: selection.date) }
    }

    private func action(_ name: String, _ title: String) -> some View {
        Button(title) { Task { _ = await store.calendarAction(name, for: entry) } }
    }
}

private struct CalendarTimeSelection: Identifiable {
    let id = UUID()
    let date: Date
}

private struct CalendarTimeEditor: View {
    let entry: CalendarEntry
    @State var date: Date
    @Environment(FarmStore.self) private var store
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Text(entry.title)
                DatePicker(store.localized("தேதியும் நேரமும்", "Date and time"), selection: $date, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                Text(store.localized("இந்திய நேரம்", "India time")).font(.caption).foregroundStyle(.secondary)
                Button(store.localized("நேரத்தைப் பயன்படுத்தவும்", "Use this time")) {
                    Task { if await store.calendarAction("change_time", for: entry, dueAt: date) { dismiss() } }
                }.disabled(store.busy).accessibilityIdentifier("calendarUseTime")
            }
            .navigationTitle(store.localized("நேரத்தை மாற்றவும்", "Change time"))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(store.localized("மூடவும்", "Close")) { dismiss() }
                }
            }
        }
        .environment(\.timeZone, farmTimeZone)
    }
}

struct EvidenceList: View {
    let ids: [String]
    @Environment(FarmStore.self) private var store
    var body: some View {
        if !ids.isEmpty {
            DisclosureGroup(store.localized("தகவல் எங்கிருந்து வந்தது?", "Where did this information come from?")) {
                ForEach((store.state?.evidence ?? []).filter { ids.contains($0.id) }) { evidence in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(evidence.title ?? evidence.source).font(.subheadline.bold())
                        if let passage = evidence.passage { Text(passage).font(.caption) }
                        if let date = evidence.observedAt { Text(String(format: store.localized("தகவல் தேதி: %@", "Data date: %@"), store.dateLabel(date))).font(.caption) }
                        Text(String(format: store.localized("பெறப்பட்ட நேரம்: %@", "Retrieved: %@"), store.dateLabel(evidence.retrievedAt))).font(.caption).foregroundStyle(.secondary)
                        if let date = evidence.validUntil { Text(String(format: store.localized("செல்லுபடியாகும் வரை: %@", "Valid until: %@"), store.dateLabel(date))).font(.caption) }
                        if let url = URL(string: evidence.url), ["https", "http"].contains(url.scheme ?? "") { Link(store.localized("மூலத்தைப் பார்க்கவும்", "View source"), destination: url).font(.caption) }
                    }.padding(.vertical, 4)
                }
            }
        }
    }
}

struct ComposerView: View {
    var calendarRequest = false
    @Environment(FarmStore.self) private var store
    @Environment(AudioController.self) private var audio
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDiscard = false
    var body: some View {
        @Bindable var store = store
        NavigationStack {
            Form {
                Section(calendarRequest ? store.localized("எதை நினைவூட்ட வேண்டும்?", "What should I remind you about?") : store.localized("இன்று உங்களுக்கு என்ன உதவி தேவை?", "What can I help with today?")) {
                    if calendarRequest {
                        Text(store.localized("நாளை காலை பம்பைப் பார்க்க நினைவூட்டு என்று சொல்லலாம்.", "Try saying “Remind me tomorrow morning to check the pump.”"))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    if !store.draft.hasAudio {
                        TextField(store.localized("இங்கே எழுதலாம்…", "Type here…"), text: $store.draft.text, axis: .vertical).lineLimit(3...8).disabled(store.draft.attempted || store.busy).accessibilityIdentifier("messageText")
                    }
                    if !store.audioConsent {
                        Text(store.localized("அனுப்பும் ஒலி, எழுத்தாக மாற்றவும் பதில் தயாரிக்கவும் சேவைகளுக்கு அனுப்பப்படும். அனுப்புவதற்கு முன் கேட்டு நீக்கலாம். எழுதிப் பேசவும் முடியும்.", "Recordings you send go to services that transcribe them and prepare a reply. You can listen or delete a recording before sending it. You can also type."))
                        Button(store.localized("ஒலியை அனுப்ப அனுமதிக்கிறேன்", "Allow audio processing")) { store.audioConsent = true; store.saveDraft() }
                    } else if !store.draft.attempted {
                        if audio.isRecording {
                            TimelineView(.periodic(from: .now, by: 1)) { context in
                                let seconds = Int(context.date.timeIntervalSince(audio.startedAt ?? context.date))
                                Text(String(format: store.localized("பதிவாகிறது · %@ / 29 நொடிகள்", "Recording · %@ / 29 seconds"), String(seconds))).foregroundStyle(.red)
                            }
                            Button(store.localized("பதிவை நிறுத்தவும்", "Stop recording"), role: .destructive) { audio.stopRecording(); store.saveDraft() }
                        } else if store.draft.hasAudio {
                            Button(store.localized("என் பதிவைக் கேட்கவும்", "Listen to my recording")) {
                                if let data = try? Data(contentsOf: store.recordingURL) { audio.play(data: data, id: "draft") }
                            }
                            Button(store.localized("பதிவை நீக்கவும்", "Delete recording"), role: .destructive) { audio.stopPlayback(); store.discardDraft() }
                        } else {
                            Button { Task {
                                do {
                                    try store.prepareDirectory()
                                    if await audio.record(to: store.recordingURL) { store.draft.hasAudio = true; store.draft.text = ""; store.saveDraft() }
                                } catch { store.error = store.localized("பதிவுக்கான இடத்தை உருவாக்க முடியவில்லை.", "Couldn't create storage for the recording.") }
                            } } label: { Label(store.localized("பேசிப் பதிவு செய்யவும்", "Record a message"), systemImage: "mic.fill") }
                        }
                        Text(store.localized("ஒரு பதிவில் 29 நொடிகள் வரை பேசலாம்.", "Record up to 29 seconds at a time.")).font(.caption).foregroundStyle(.secondary)
                    }
                    if let error = audio.error { Text(store.audioError(error)).font(.caption).foregroundStyle(.red) }
                }
                if store.draft.attempted {
                    Section {
                        Text(store.localized("அனுப்பியதற்கான உறுதி இன்னும் வரவில்லை. மீண்டும் அனுப்பினால் இதே செய்தி மட்டும் மீண்டும் முயற்சிக்கப்படும்.", "Delivery hasn't been confirmed. Sending again retries the same message."))
                        Button(store.localized("வரைவை நீக்கவும்", "Delete draft"), role: .destructive) { confirmDiscard = true }
                    }
                }
                Section {
                    Button(store.busy ? store.localized("அனுப்புகிறது…", "Sending…") : store.draft.attempted ? store.localized("மீண்டும் அனுப்பவும்", "Send again") : store.localized("அனுப்பவும்", "Send")) {
                        audio.stopPlayback()
                        Task { if await store.sendDraft() { dismiss() } }
                    }.disabled(store.busy || audio.isRecording || (!store.draft.hasAudio && store.draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)).accessibilityIdentifier("sendMessage")
                }
            }
            .navigationTitle(store.localized("உங்கள் பதில்", "Your reply"))
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(store.localized("மூடவும்", "Close")) { audio.stopRecording(); store.saveDraft(); dismiss() } } }
            .interactiveDismissDisabled(audio.isRecording || store.busy)
            .onChange(of: store.draft.text) { _, _ in store.saveDraft() }
            .onDisappear { audio.stopRecording(); store.saveDraft() }
            .confirmationDialog(store.localized("வரைவை நீக்க வேண்டுமா? ஏற்கெனவே சென்ற செய்தி உரையாடலில் இருக்கலாம்.", "Delete this draft? If it was already sent, it may appear in the conversation."), isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button(store.localized("வரைவை நீக்கவும்", "Delete draft"), role: .destructive) { store.discardDraft() }
            }
        }
    }
}
