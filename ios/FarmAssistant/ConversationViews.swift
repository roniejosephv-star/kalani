import SwiftUI

struct TodayView: View {
    @Environment(FarmStore.self) private var store
    @State private var composer: ComposerSheet?
    var body: some View {
        List {
            if !store.connected { Label("இணைப்பு துண்டிக்கப்பட்டுள்ளது. மீண்டும் இணைக்கிறது…", systemImage: "wifi.slash").foregroundStyle(.secondary) }
            Section {
                Text(store.state?.facts["crop"]?.text ?? "").font(.headline)
                Text(store.state?.facts["village"]?.text ?? "").foregroundStyle(.secondary)
            }
            Section("சமீபத்திய வழிகாட்டல்") {
                if let message = store.state?.messages.last(where: { $0.role == "assistant" && $0.status != "superseded" }) {
                    MessageCard(message: message)
                } else {
                    Text("இன்னும் புதிய வழிகாட்டல் இல்லை. இன்று உங்களுக்கு என்ன உதவி தேவை?")
                }
            }
            Section {
                Button { composer = ComposerSheet() } label: { Label("பேசிப் பதில் சொல்லவும்", systemImage: "mic.fill").font(.headline) }.accessibilityIdentifier("reply")
                ForEach(["என் பயிருக்கு இன்று என்ன கவனிக்க வேண்டும்?", "இந்த வார வானிலை பற்றி சொல்லுங்கள்", "சந்தை விலை பற்றி தெரிந்துகொள்ள வேண்டும்", "அரசு உதவிகள் பற்றி சொல்லுங்கள்"], id: \.self) { question in
                    Button(question) {
                        if !store.draft.attempted && !store.draft.hasAudio { store.draft.text = question; store.saveDraft() }
                        composer = ComposerSheet()
                    }
                }
            }
            if let pending = store.state?.messages.last(where: { $0.role == "farmer" && ["queued", "processing", "failed"].contains($0.status) }) {
                Section("உங்கள் செய்தி") { MessageCard(message: pending) }
            }
        }
        .navigationTitle("இன்று")
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
            if store.state?.messages.isEmpty != false { Text("உங்கள் முதல் கேள்வியைப் பேசலாம் அல்லது எழுதலாம்.") }
            ForEach(store.state?.messages ?? []) { message in
                Section(message.role == "farmer" ? "நீங்கள்" : "பண்ணை உதவி") { MessageCard(message: message) }
            }
        }
        .navigationTitle("உரையாடல்")
        .toolbar { Button { composer = ComposerSheet() } label: { Label("பதில் சொல்லவும்", systemImage: "square.and.pencil") } }
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
    @State private var error: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(displayDate(message.createdAt)).font(.caption).foregroundStyle(.secondary)
            if !message.text.isEmpty { Text(message.text).textSelection(.enabled) }
            if message.status != "ready" { Text(tamilStatus(message.status)).font(.caption).foregroundStyle(.secondary) }
            if let id = message.audioId {
                Button {
                    Task {
                        loadingAudio = true
                        defer { loadingAudio = false }
                        do {
                            guard let client = store.client else { return }
                            let identity = store.sessionID
                            let data = try await client.data("/v1/audio/\(id)")
                            guard identity == store.sessionID else { return }
                            audio.play(data: data, id: id)
                        } catch { self.error = "ஒலியைப் பெற முடியவில்லை. மீண்டும் முயற்சிக்கவும்." }
                    }
                } label: {
                    Label(audio.isPlaying && audio.playingID == id ? "நிறுத்தவும்" : "கேட்கவும் / மீண்டும் கேட்கவும்", systemImage: audio.isPlaying && audio.playingID == id ? "stop.fill" : "play.circle.fill")
                }
                .accessibilityIdentifier("\(message.role)-audio-\(message.id)")
                .accessibilityValue(audio.isPlaying && audio.playingID == id ? "playing" : "idle")
                .disabled(loadingAudio)
                if loadingAudio { ProgressView() }
            } else if message.role == "assistant", let status = message.audioStatus {
                Text(tamilStatus(status)).font(.caption).foregroundStyle(.secondary)
                if ["failed", "unconfigured"].contains(status) {
                    Button("ஒலியை மீண்டும் தயாரிக்கவும்") {
                        Task { _ = await store.mutate("/v1/messages/\(message.id)/retry-audio", body: ["requestId": UUID().uuidString]) }
                    }.disabled(store.busy)
                }
            }
            if let error { Text(error).foregroundStyle(.red).font(.caption) }
            if let error = audio.error { Text(error).foregroundStyle(.secondary).font(.caption) }
            if let error = message.error { Text(tamilServiceError(error)).font(.caption).foregroundStyle(.secondary) }
            if message.role == "farmer" && message.status == "failed" {
                Button("இந்தச் செய்தியை மீண்டும் முயற்சிக்கவும்") {
                    Task {
                        if await store.retryMessage(message.id, requestId: retryRequestID) { retryRequestID = UUID().uuidString }
                    }
                }.disabled(store.busy).accessibilityIdentifier("retryMessage")
            }
            EvidenceList(ids: message.evidenceIds ?? [])
        }.padding(.vertical, 6)
        .onChange(of: message.id) { _, _ in retryRequestID = UUID().uuidString }
    }
}

struct EvidenceList: View {
    let ids: [String]
    @Environment(FarmStore.self) private var store
    var body: some View {
        if !ids.isEmpty {
            DisclosureGroup("தகவல் எங்கிருந்து வந்தது?") {
                ForEach((store.state?.evidence ?? []).filter { ids.contains($0.id) }) { evidence in
                    VStack(alignment: .leading, spacing: 5) {
                        Text(evidence.title ?? evidence.source).font(.subheadline.bold())
                        if let passage = evidence.passage { Text(passage).font(.caption) }
                        if let date = evidence.observedAt { Text("தகவல் தேதி: \(displayDate(date))").font(.caption) }
                        Text("பெறப்பட்ட நேரம்: \(displayDate(evidence.retrievedAt))").font(.caption).foregroundStyle(.secondary)
                        if let date = evidence.validUntil { Text("செல்லுபடியாகும் வரை: \(displayDate(date))").font(.caption) }
                        if let url = URL(string: evidence.url), ["https", "http"].contains(url.scheme ?? "") { Link("மூலத்தைப் பார்க்கவும்", destination: url).font(.caption) }
                    }.padding(.vertical, 4)
                }
            }
        }
    }
}

struct ComposerView: View {
    @Environment(FarmStore.self) private var store
    @Environment(AudioController.self) private var audio
    @Environment(\.dismiss) private var dismiss
    @State private var confirmDiscard = false
    var body: some View {
        @Bindable var store = store
        NavigationStack {
            Form {
                Section("இன்று உங்களுக்கு என்ன உதவி தேவை?") {
                    if !store.draft.hasAudio {
                        TextField("இங்கே எழுதலாம்…", text: $store.draft.text, axis: .vertical).lineLimit(3...8).disabled(store.draft.attempted || store.busy).accessibilityIdentifier("messageText")
                    }
                    if !store.audioConsent {
                        Text("அனுப்பும் ஒலி, எழுத்தாக மாற்றவும் பதில் தயாரிக்கவும் சேவைகளுக்கு அனுப்பப்படும். அனுப்புவதற்கு முன் கேட்டு நீக்கலாம். எழுதிப் பேசவும் முடியும்.")
                        Button("ஒலியை அனுப்ப அனுமதிக்கிறேன்") { store.audioConsent = true; store.saveDraft() }
                    } else if !store.draft.attempted {
                        if audio.isRecording {
                            TimelineView(.periodic(from: .now, by: 1)) { context in
                                Text("பதிவாகிறது · \(Int(context.date.timeIntervalSince(audio.startedAt ?? context.date))) / 29 நொடிகள்").foregroundStyle(.red)
                            }
                            Button("பதிவை நிறுத்தவும்", role: .destructive) { audio.stopRecording(); store.saveDraft() }
                        } else if store.draft.hasAudio {
                            Button("என் பதிவைக் கேட்கவும்") {
                                if let data = try? Data(contentsOf: store.recordingURL) { audio.play(data: data, id: "draft") }
                            }
                            Button("பதிவை நீக்கவும்", role: .destructive) { audio.stopPlayback(); store.discardDraft() }
                        } else {
                            Button { Task {
                                do {
                                    try store.prepareDirectory()
                                    if await audio.record(to: store.recordingURL) { store.draft.hasAudio = true; store.draft.text = ""; store.saveDraft() }
                                } catch { store.error = "பதிவுக்கான இடத்தை உருவாக்க முடியவில்லை." }
                            } } label: { Label("பேசிப் பதிவு செய்யவும்", systemImage: "mic.fill") }
                        }
                        Text("ஒரு பதிவில் 29 நொடிகள் வரை பேசலாம்.").font(.caption).foregroundStyle(.secondary)
                    }
                    if let error = audio.error { Text(error).font(.caption).foregroundStyle(.red) }
                }
                if store.draft.attempted {
                    Section {
                        Text("அனுப்பியதற்கான உறுதி இன்னும் வரவில்லை. மீண்டும் அனுப்பினால் இதே செய்தி மட்டும் மீண்டும் முயற்சிக்கப்படும்.")
                        Button("வரைவை நீக்கவும்", role: .destructive) { confirmDiscard = true }
                    }
                }
                Section {
                    Button(store.busy ? "அனுப்புகிறது…" : store.draft.attempted ? "மீண்டும் அனுப்பவும்" : "அனுப்பவும்") {
                        audio.stopPlayback()
                        Task { if await store.sendDraft() { dismiss() } }
                    }.disabled(store.busy || audio.isRecording || (!store.draft.hasAudio && store.draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)).accessibilityIdentifier("sendMessage")
                }
            }
            .navigationTitle("உங்கள் பதில்")
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("மூடவும்") { audio.stopRecording(); store.saveDraft(); dismiss() } } }
            .interactiveDismissDisabled(audio.isRecording || store.busy)
            .onChange(of: store.draft.text) { _, _ in store.saveDraft() }
            .onDisappear { audio.stopRecording(); store.saveDraft() }
            .confirmationDialog("வரைவை நீக்க வேண்டுமா? ஏற்கெனவே சென்ற செய்தி உரையாடலில் இருக்கலாம்.", isPresented: $confirmDiscard, titleVisibility: .visible) {
                Button("வரைவை நீக்கவும்", role: .destructive) { store.discardDraft() }
            }
        }
    }
}
