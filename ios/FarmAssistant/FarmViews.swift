import SwiftUI
import UserNotifications

struct FarmFactsView: View {
    let onboarding: Bool
    @Environment(FarmStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var village = ""
    @State private var crop = ""
    @State private var district = ""
    @State private var latitude = ""
    @State private var longitude = ""
    @State private var soil = ""
    @State private var irrigation = ""
    @State private var expectedVersion = 0
    @State private var loaded = false
    @State private var confirmation: FactConfirmation?
    @State private var composer: ComposerSheet?
    var body: some View {
        Form {
            Section {
                Text(onboarding ? "உங்கள் வயலைப் பற்றி இரண்டு விவரங்கள்" : "விவரங்களைத் திருத்தவும்").font(.headline)
                Text("தெரிந்தவற்றை மட்டும் சொல்லுங்கள். பின்னர் மாற்றலாம்.")
            }
            if onboarding {
                Section("பேசித் தொடங்கலாம்") {
                    Button { composer = ComposerSheet() } label: { Label("உங்கள் பண்ணையைப் பற்றிச் சொல்லுங்கள்", systemImage: "mic.fill") }
                    if let message = store.state?.messages.last(where: { $0.role == "assistant" && $0.status != "superseded" }) {
                        MessageCard(message: message)
                        if let facts = message.proposedFacts, !facts.isEmpty {
                            Button("நான் சொன்ன விவரங்களைச் சரிபார்க்கவும்") { applySuggestedFacts(facts) }
                        }
                    }
                    Text("வழிகாட்டியின் பதிலைப் பார்த்து, கீழே உள்ள விவரங்களை உறுதி செய்யவும்.").font(.caption).foregroundStyle(.secondary)
                }
            }
            Section {
                TextField("உங்கள் வயல் எந்த ஊரில் இருக்கிறது?", text: locationField($village)).accessibilityIdentifier("village")
                TextField("இப்போது என்ன பயிர் சாகுபடி செய்கிறீர்கள்?", text: $crop).accessibilityIdentifier("crop")
                TextField("மாவட்டம் (தெரிந்தால்)", text: locationField($district)).accessibilityIdentifier("district")
            }
            Section {
                DisclosureGroup("கூடுதல் விவரங்கள் (விருப்பம்)") {
                    TextField("மண் வகை", text: $soil)
                    TextField("நீர் / பாசன முறை", text: $irrigation)
                    TextField("வயலின் அட்சரேகை · Latitude", text: $latitude).keyboardType(.numbersAndPunctuation).accessibilityIdentifier("latitude")
                    TextField("வயலின் தீர்க்கரேகை · Longitude", text: $longitude).keyboardType(.numbersAndPunctuation).accessibilityIdentifier("longitude")
                    Text("இடம் சரியாக உறுதி செய்யப்பட்ட பின்னரே உள்ளூர் வானிலை கிடைக்கும். தெரியாத இட எண்ணை ஊகிக்க வேண்டாம்.").font(.caption).foregroundStyle(.secondary)
                }
            }
            Section {
                Button("விவரங்களைச் சரிபார்க்கவும்") { prepareConfirmation() }
                    .disabled(village.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || crop.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.busy)
                    .accessibilityIdentifier("reviewFacts")
            }
        }
        .navigationTitle(onboarding ? "உங்கள் பண்ணை" : "திருத்தம்")
        .task {
            guard !loaded, let state = store.state else { return }
            loaded = true
            village = state.facts["village"]?.text ?? ""
            crop = state.facts["crop"]?.text ?? ""
            district = state.facts["district"]?.text ?? ""
            latitude = state.facts["latitude"]?.text ?? ""
            longitude = state.facts["longitude"]?.text ?? ""
            soil = state.facts["soil"]?.text ?? ""
            irrigation = state.facts["irrigation"]?.text ?? ""
            expectedVersion = state.version
        }
        .sheet(item: $composer) { _ in ComposerView() }
        .sheet(item: $confirmation) { confirmation in
            NavigationStack {
                Form {
                    Section("நான் புரிந்துகொண்டது") {
                        ForEach(confirmation.rows, id: \.0) { row in LabeledContent(row.0, value: row.1) }
                    }
                    Section {
                        Text("இந்த விவரங்கள் மாறினால் பழைய வழிகாட்டலையும் வரவிருக்கும் நினைவூட்டல்களையும் மீண்டும் பரிசீலிப்போம். செய்த வேலைகளின் பதிவு தொடரும்.")
                        Button("விவரங்கள் சரி") {
                            Task {
                                var body = confirmation.body
                                body["requestId"] = confirmation.id.uuidString
                                if await store.mutate("/v1/facts", body: body) {
                                    self.confirmation = nil
                                    if !onboarding { dismiss() }
                                } else if store.state?.version != expectedVersion {
                                    self.confirmation = nil
                                    loaded = false
                                }
                            }
                        }.disabled(store.busy).accessibilityIdentifier("confirmFacts")
                        Button("திருத்த வேண்டும்") { self.confirmation = nil }
                    }
                }.navigationTitle("உறுதி செய்யவும்")
            }
        }
    }
    private func locationField(_ field: Binding<String>) -> Binding<String> {
        Binding(get: { field.wrappedValue }, set: { value in
            if field.wrappedValue.trimmingCharacters(in: .whitespacesAndNewlines) != value.trimmingCharacters(in: .whitespacesAndNewlines) {
                latitude = ""
                longitude = ""
            }
            field.wrappedValue = value
        })
    }
    private func applySuggestedFacts(_ facts: [String: FactValue]) {
        if let value = facts["village"] { locationField($village).wrappedValue = value.text }
        if let value = facts["crop"] { crop = value.text }
        if let value = facts["district"] { locationField($district).wrappedValue = value.text }
        if let value = facts["soil"] { soil = value.text }
        if let value = facts["irrigation"] { irrigation = value.text }
        expectedVersion = store.state?.version ?? expectedVersion
        guard !village.isEmpty, !crop.isEmpty else {
            store.error = "ஊர் மற்றும் பயிர் விவரத்தை இன்னும் உறுதி செய்ய வேண்டும். விடுபட்ட விவரத்தை கீழே சேர்க்கலாம் அல்லது மீண்டும் பேசலாம்."
            return
        }
        prepareConfirmation()
    }
    private func prepareConfirmation() {
        guard let state = store.state else { return }
        if expectedVersion != state.version {
            expectedVersion = state.version
            store.error = "புதிய தகவல் வந்துள்ளது. நீங்கள் உள்ளிட்ட விவரங்களை மீண்டும் பார்த்து உறுதி செய்யவும்."
            return
        }
        var facts: [String: Any] = [:]
        var rows: [(String, String)] = []
        for (key, label, value) in [("village", "ஊர்", village), ("crop", "பயிர்", crop), ("district", "மாவட்டம்", district), ("soil", "மண்", soil), ("irrigation", "பாசனம்", irrigation)] {
            let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty { facts[key] = value; rows.append((label, value)) }
            else if key == "district", let previous = state.facts[key]?.text, !previous.isEmpty {
                facts[key] = ""
                rows.append((label, "நீக்கப்படும்"))
            }
        }
        if !latitude.isEmpty || !longitude.isEmpty {
            guard let lat = Double(latitude), let lon = Double(longitude), (-90...90).contains(lat), (-180...180).contains(lon) else {
                store.error = "இட எண்கள் சரியாக இல்லை. இரண்டையும் சரிபார்க்கவும் அல்லது இரண்டையும் காலியாக விடவும்."
                return
            }
            facts["latitude"] = lat; facts["longitude"] = lon
            rows.append(("இடம்", "\(lat), \(lon)"))
        }
        confirmation = FactConfirmation(rows: rows, body: ["expectedVersion": expectedVersion, "facts": facts, "fieldId": state.fieldId, "cycleId": state.cycleId])
    }
}
struct FactConfirmation: Identifiable { let id = UUID(); let rows: [(String, String)]; let body: [String: Any] }
struct TaskDecision: Identifiable { let id = UUID(); let task: FarmTask; let decision: String; let label: String }

struct WeekView: View {
    @Environment(FarmStore.self) private var store
    @State private var decision: TaskDecision?
    var body: some View {
        ScrollViewReader { proxy in
            List {
                if store.state?.tasks.isEmpty != false { Text("இன்னும் வேலைத் திட்டம் இல்லை. உங்கள் கவலையைச் சொல்லுங்கள்; ஆதாரங்களுடன் திட்டத்தை உருவாக்குவோம்.") }
                ForEach(store.state?.tasks ?? []) { task in
                    Section {
                        VStack(alignment: .leading, spacing: 10) {
                            Text(task.title).font(.headline)
                            Text(displayDate(task.dueAt)).font(.caption).foregroundStyle(.secondary)
                            Text(task.reason)
                            Text(tamilStatus(task.status)).font(.subheadline.bold())
                            ForEach(task.uncertainty, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
                            EvidenceList(ids: task.evidenceIds)
                            if task.status == "proposed" {
                                Button("செய்ய ஒப்புக்கொள்கிறேன்") { decision = TaskDecision(task: task, decision: "approved", label: "செய்ய ஒப்புக்கொள்கிறேன்") }
                            }
                            if task.status == "postponed" {
                                Text("புதிய தகவலுடன் திட்டத்தை மீண்டும் கேளுங்கள். பழைய ஒப்புதலை மீண்டும் பயன்படுத்த முடியாது.").font(.caption).foregroundStyle(.secondary)
                            }
                            if ["proposed", "approved", "postponed"].contains(task.status) {
                                Button("செய்துவிட்டேன்") { decision = TaskDecision(task: task, decision: "completed", label: "செய்துவிட்டேன்") }
                                Button("பிறகு செய்யலாம்") { decision = TaskDecision(task: task, decision: "postponed", label: "பிறகு செய்யலாம்") }
                                Button("வேண்டாம்", role: .destructive) { decision = TaskDecision(task: task, decision: "rejected", label: "வேண்டாம்") }
                            }
                        }.padding(.vertical, 6)
                    }.id(task.id)
                }
                if let notifications = store.state?.notifications, !notifications.isEmpty {
                    Section("நினைவூட்டல்கள்") {
                        ForEach(notifications) { notification in
                            VStack(alignment: .leading) {
                                Text(notification.title)
                                Text(displayDate(notification.dueAt)).font(.caption).foregroundStyle(.secondary)
                                Text(tamilStatus(notification.status)).font(.caption)
                            }
                        }
                    }
                }
            }.onChange(of: store.selectedTaskID) { _, id in if let id { proxy.scrollTo(id, anchor: .top) } }
        }
        .navigationTitle("இந்த வாரம்")
        .refreshable { await store.refresh() }
        .sheet(item: $decision) { selection in
            NavigationStack {
                Form {
                    Text(selection.task.title).font(.headline)
                    Text(selection.task.reason)
                    Text(selection.decision == "completed" ? "நீங்கள் செய்ததாக மட்டும் பதிவு செய்கிறோம். இது பழைய ஒப்புதலாக மாற்றப்படாது." : "இந்த வேலைக்கும் இந்தப் பதிப்புக்கும் மட்டும் உங்கள் முடிவைப் பதிவு செய்கிறோம். வெளியே எந்தச் செயலும் தானாக நடைபெறாது.")
                    Button(selection.label) {
                        Task {
                            if await store.mutate("/v1/tasks/\(selection.task.id)/decisions", body: ["requestId": selection.id.uuidString, "version": selection.task.version, "decision": selection.decision]) { decision = nil }
                        }
                    }.disabled(store.busy)
                    Button("மீண்டும் பார்க்கவும்") { decision = nil }
                }.navigationTitle("உங்கள் முடிவு")
            }
        }
    }
}

struct MyFarmView: View {
    @Environment(FarmStore.self) private var store
    @State private var exportURL: URL?
    @State private var confirmDelete = false
    @State private var notificationMessage: String?
    var body: some View {
        Form {
            Section("பண்ணை விவரங்கள்") {
                ForEach((store.state?.facts.keys.sorted() ?? []), id: \.self) { key in
                    LabeledContent(factLabel(key), value: store.state?.facts[key]?.text ?? "")
                }
                NavigationLink("விவரங்களைத் திருத்தவும்") { FarmFactsView(onboarding: false) }
            }
            Section("மொழி மற்றும் ஒலி") {
                Text("தமிழ்")
                Text("உள்ளூர் சொற்களைப் புரிந்துகொள்ள முயற்சிப்போம். புரியாதவற்றைக் கேட்டு உறுதி செய்வோம்.").font(.caption).foregroundStyle(.secondary)
                Toggle("ஒலியைச் செயலாக்க அனுமதி", isOn: Binding(get: { store.audioConsent }, set: { store.audioConsent = $0; store.saveDraft() }))
            }
            Section("அறிவிப்புகள்") {
                Toggle("நினைவூட்டல்கள் வேண்டும்", isOn: Binding(get: { store.state?.preferences.notifications ?? false }, set: { enabled in
                    Task { _ = await store.mutate("/v1/preferences", method: "PATCH", body: ["requestId": UUID().uuidString, "notifications": enabled]) }
                })).disabled(store.busy)
                if let preference = store.state?.preferences {
                    Picker("அமைதி தொடங்கும் நேரம்", selection: Binding(get: { preference.quietStart }, set: { hour in
                        Task { _ = await store.mutate("/v1/preferences", method: "PATCH", body: ["requestId": UUID().uuidString, "quietStart": hour]) }
                    })) { ForEach(0..<24) { Text(String(format: "%02d:00", $0)).tag($0) } }.disabled(store.busy)
                    Picker("அமைதி முடியும் நேரம்", selection: Binding(get: { preference.quietEnd }, set: { hour in
                        Task { _ = await store.mutate("/v1/preferences", method: "PATCH", body: ["requestId": UUID().uuidString, "quietEnd": hour]) }
                    })) { ForEach(0..<24) { Text(String(format: "%02d:00", $0)).tag($0) } }.disabled(store.busy)
                    Text("இந்திய நேரம்").font(.caption).foregroundStyle(.secondary)
                }
                Button("சோதனை அறிவிப்பைப் பார்க்கவும்") {
                    Task {
                        do {
                            let center = UNUserNotificationCenter.current()
                            guard try await center.requestAuthorization(options: [.alert, .sound]) else { notificationMessage = "அறிவிப்பு அனுமதி இல்லை. அமைப்புகளில் மாற்றலாம்."; return }
                            let content = UNMutableNotificationContent()
                            content.title = "சோதனை அறிவிப்பு"
                            content.body = "இது Simulator-இன் உள்ளூர் சோதனை மட்டுமே. பண்ணைக்கான நேரடி அறிவிப்பு அல்ல."
                            content.sound = .default
                            if let id = store.state?.tasks.first?.id { content.userInfo = ["taskId": id] }
                            try await center.add(UNNotificationRequest(identifier: "local-demo", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false)))
                            notificationMessage = "5 நொடிகளில் சோதனை அறிவிப்பு வரும்."
                        } catch { notificationMessage = "சோதனை அறிவிப்பை உருவாக்க முடியவில்லை." }
                    }
                }
                if let notificationMessage { Text(notificationMessage).font(.caption) }
                Text("இந்த demo-வில் தொலைபேசிக்கான நேரடி push சேவை இணைக்கப்படவில்லை.").font(.caption).foregroundStyle(.secondary)
            }
            Section("உங்கள் தகவல்") {
                Button("என் தகவலைப் பதிவிறக்கவும்") {
                    Task {
                        do {
                            guard let client = store.client else { return }
                            let identity = store.sessionID
                            let data = try await client.data("/v1/export")
                            guard identity == store.sessionID else { return }
                            try store.prepareDirectory()
                            let url = store.localDirectory.appendingPathComponent("farm-export.json")
                            try data.write(to: url, options: [.atomic, .completeFileProtection])
                            exportURL = url
                        } catch { store.error = "தகவலைப் பதிவிறக்க முடியவில்லை." }
                    }
                }
                if let exportURL { ShareLink("என் தகவலைச் சேமிக்கவும் / பகிரவும்", item: exportURL) }
                Text("இந்தப் பதிவில் உங்கள் தனிப்பட்ட பண்ணைத் தகவல் இருக்கும். நம்பகமான இடத்தில் மட்டும் சேமிக்கவும்.").font(.caption).foregroundStyle(.secondary)
                Button("என் தகவலை நீக்கவும்", role: .destructive) { confirmDelete = true }
                Button("இந்தச் சாதனத்தின் இணைப்பை நீக்கவும்") { store.clearSession() }
            }
        }
        .navigationTitle("என் பண்ணை")
        .confirmationDialog("சேவையிலுள்ள உங்கள் தகவலை நீக்க வேண்டுமா? காப்புப்பிரதிகளுக்கான தனி சேமிப்புக் கொள்கை பொருந்தும்.", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("நீக்கவும்", role: .destructive) {
                Task {
                    let directory = store.localDirectory
                    if await store.mutate("/v1/account", method: "DELETE", body: ["requestId": UUID().uuidString, "confirmation": "DELETE"]) {
                        try? FileManager.default.removeItem(at: directory)
                        store.clearSession()
                    }
                }
            }
        }
    }
    private func factLabel(_ key: String) -> String {
        ["village": "ஊர்", "crop": "பயிர்", "district": "மாவட்டம்", "soil": "மண்", "irrigation": "பாசனம்", "latitude": "அட்சரேகை", "longitude": "தீர்க்கரேகை", "sowingDate": "விதைத்த தேதி"][key] ?? key
    }
}
