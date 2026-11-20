import SwiftUI
import UserNotifications

struct FarmFactsView: View {
    let onboarding: Bool
    @Environment(FarmStore.self) private var store
    @Environment(\.dismiss) private var dismiss
    @State private var village = ""
    @State private var crop = ""
    @State private var district = ""
    @State private var province = ""
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
                Text(onboarding ? store.localized("உங்கள் வயலைப் பற்றி இரண்டு விவரங்கள்", "Two details about your farm") : store.localized("விவரங்களைத் திருத்தவும்", "Edit farm details")).font(.headline)
                Text(store.localized("தெரிந்தவற்றை மட்டும் சொல்லுங்கள். பின்னர் மாற்றலாம்.", "Share what you know. You can change it later."))
            }
            if onboarding {
                Section(store.localized("பேசித் தொடங்கலாம்", "Start by speaking")) {
                    Button { composer = ComposerSheet() } label: { Label(store.localized("உங்கள் பண்ணையைப் பற்றிச் சொல்லுங்கள்", "Tell us about your farm"), systemImage: "mic.fill") }
                    if let message = store.state?.messages.last(where: { $0.role == "assistant" && $0.status != "superseded" }) {
                        MessageCard(message: message)
                        if let facts = message.proposedFacts, !facts.isEmpty {
                            Button(store.localized("நான் சொன்ன விவரங்களைச் சரிபார்க்கவும்", "Review the details I shared")) { applySuggestedFacts(facts) }
                        }
                    }
                    Text(store.localized("வழிகாட்டியின் பதிலைப் பார்த்து, கீழே உள்ள விவரங்களை உறுதி செய்யவும்.", "Review the reply and confirm your details below.")).font(.caption).foregroundStyle(.secondary)
                }
            }
            Section {
                TextField(store.localized("உங்கள் வயல் எந்த ஊரில் இருக்கிறது?", "Which village is your farm in?"), text: locationField($village)).accessibilityIdentifier("village")
                TextField(store.localized("இப்போது என்ன பயிர் சாகுபடி செய்கிறீர்கள்?", "What crop are you growing now?"), text: $crop).accessibilityIdentifier("crop")
                TextField(store.localized("மாவட்டம் (தெரிந்தால்)", "District (if known)"), text: locationField($district)).accessibilityIdentifier("district")
                TextField(store.localized("மாநிலம் (தெரிந்தால்)", "State (if known)"), text: locationField($province)).accessibilityIdentifier("farmState")
            }
            Section {
                DisclosureGroup(store.localized("கூடுதல் விவரங்கள் (விருப்பம்)", "More details (optional)")) {
                    TextField(store.localized("மண் வகை", "Soil type"), text: $soil)
                    TextField(store.localized("நீர் / பாசன முறை", "Irrigation method"), text: $irrigation)
                    TextField(store.localized("வயலின் அட்சரேகை · Latitude", "Farm latitude"), text: $latitude).keyboardType(.numbersAndPunctuation).accessibilityIdentifier("latitude")
                    TextField(store.localized("வயலின் தீர்க்கரேகை · Longitude", "Farm longitude"), text: $longitude).keyboardType(.numbersAndPunctuation).accessibilityIdentifier("longitude")
                    Text(store.localized("இடம் சரியாக உறுதி செய்யப்பட்ட பின்னரே உள்ளூர் வானிலை கிடைக்கும். தெரியாத இட எண்ணை ஊகிக்க வேண்டாம்.", "Local weather needs confirmed coordinates. Leave them blank if you don't know them.")).font(.caption).foregroundStyle(.secondary)
                }
            }
            Section {
                Button(store.localized("விவரங்களைச் சரிபார்க்கவும்", "Review details")) { prepareConfirmation() }
                    .disabled(village.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || crop.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.busy)
                    .accessibilityIdentifier("reviewFacts")
            }
        }
        .navigationTitle(onboarding ? store.localized("உங்கள் பண்ணை", "Your farm") : store.localized("திருத்தம்", "Edit"))
        .task {
            guard !loaded, let state = store.state else { return }
            loaded = true
            village = state.facts["village"]?.text ?? ""
            crop = state.facts["crop"]?.text ?? ""
            district = state.facts["district"]?.text ?? ""
            province = state.facts["state"]?.text ?? ""
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
                    Section(store.localized("நான் புரிந்துகொண்டது", "What I understood")) {
                        ForEach(confirmation.rows, id: \.0) { row in LabeledContent(row.0, value: row.1) }
                    }
                    Section {
                        Text(store.localized("இந்த விவரங்கள் மாறினால் பழைய வழிகாட்டலையும் வரவிருக்கும் நினைவூட்டல்களையும் மீண்டும் பரிசீலிப்போம். செய்த வேலைகளின் பதிவு தொடரும்.", "Changing these details means we'll review earlier guidance and upcoming reminders. Completed work stays in your record."))
                        Button(store.localized("விவரங்கள் சரி", "Confirm details")) {
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
                        Button(store.localized("திருத்த வேண்டும்", "Make a correction")) { self.confirmation = nil }
                    }
                }.navigationTitle(store.localized("உறுதி செய்யவும்", "Confirm"))
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
        if let value = facts["state"] { locationField($province).wrappedValue = value.text }
        if let value = facts["soil"] { soil = value.text }
        if let value = facts["irrigation"] { irrigation = value.text }
        expectedVersion = store.state?.version ?? expectedVersion
        guard !village.isEmpty, !crop.isEmpty else {
            store.error = store.localized("ஊர் மற்றும் பயிர் விவரத்தை இன்னும் உறுதி செய்ய வேண்டும். விடுபட்ட விவரத்தை கீழே சேர்க்கலாம் அல்லது மீண்டும் பேசலாம்.", "Confirm your village and crop. Enter missing details below or speak again.")
            return
        }
        prepareConfirmation()
    }
    private func prepareConfirmation() {
        guard let state = store.state else { return }
        if expectedVersion != state.version {
            expectedVersion = state.version
            store.error = store.localized("புதிய தகவல் வந்துள்ளது. நீங்கள் உள்ளிட்ட விவரங்களை மீண்டும் பார்த்து உறுதி செய்யவும்.", "New information arrived. Review and confirm the details you entered.")
            return
        }
        var facts: [String: Any] = [:]
        var rows: [(String, String)] = []
        for (key, label, value) in [("village", store.localized("ஊர்", "Village"), village), ("crop", store.localized("பயிர்", "Crop"), crop), ("district", store.localized("மாவட்டம்", "District"), district), ("state", store.localized("மாநிலம்", "State"), province), ("soil", store.localized("மண்", "Soil"), soil), ("irrigation", store.localized("பாசனம்", "Irrigation"), irrigation)] {
            let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
            if !value.isEmpty { facts[key] = value; rows.append((label, value)) }
            else if ["district", "state"].contains(key), let previous = state.facts[key]?.text, !previous.isEmpty {
                facts[key] = ""
                rows.append((label, store.localized("நீக்கப்படும்", "Will be removed")))
            }
        }
        if !latitude.isEmpty || !longitude.isEmpty {
            guard let lat = Double(latitude), let lon = Double(longitude), (-90...90).contains(lat), (-180...180).contains(lon) else {
                store.error = store.localized("இட எண்கள் சரியாக இல்லை. இரண்டையும் சரிபார்க்கவும் அல்லது இரண்டையும் காலியாக விடவும்.", "Check both coordinates or leave them both blank.")
                return
            }
            facts["latitude"] = lat; facts["longitude"] = lon
            rows.append((store.localized("இடம்", "Location"), "\(lat), \(lon)"))
        }
        confirmation = FactConfirmation(rows: rows, body: ["expectedVersion": expectedVersion, "facts": facts, "fieldId": state.fieldId, "cycleId": state.cycleId])
    }
}
struct FactConfirmation: Identifiable { let id = UUID(); let rows: [(String, String)]; let body: [String: Any] }
struct TaskDecision: Identifiable { let id = UUID(); let task: FarmTask; let decision: String; let label: String }

struct WeekView: View {
    @Environment(FarmStore.self) private var store
    @State private var decision: TaskDecision?
    @State private var composer: ComposerSheet?

    private var agenda: [AgendaItem] {
        let state = store.state
        let events = (state?.calendarEntries ?? []).filter {
            $0.status == "saved" && $0.fieldId == state?.fieldId && $0.cycleId == state?.cycleId
        }
        let tasks = (state?.tasks ?? []).filter { $0.status == "approved" }
        return (events.map(AgendaItem.event) + tasks.map(AgendaItem.task)).sorted { $0.dueAt < $1.dueAt }
    }

    var body: some View {
        ScrollViewReader { proxy in
            List {
                Section {
                    @Bindable var store = store
                    DatePicker(store.localized("நாளைத் தேர்ந்தெடுக்கவும்", "Choose a day"), selection: $store.calendarDay, displayedComponents: .date)
                        .accessibilityIdentifier("calendarDay")
                    Button(store.localized("இன்று", "Today")) { store.calendarDay = farmCalendar.startOfDay(for: .now) }
                    Button { composer = ComposerSheet() } label: {
                        Label(store.localized("நினைவூட்டல் சேர்க்கவும்", "Add a reminder"), systemImage: "plus.circle")
                    }.accessibilityIdentifier("addCalendarEvent")
                }
                .environment(\.timeZone, farmTimeZone)

                let selected = agenda.filter { $0.date.map { farmCalendar.isDate($0, inSameDayAs: store.calendarDay) } ?? false }
                Section(store.localized("தேர்ந்தெடுத்த நாள்", "Selected day")) {
                    if selected.isEmpty {
                        Text(store.localized("இந்த நாளில் எதுவும் திட்டமிடப்படவில்லை.", "Nothing is scheduled for this day.")).foregroundStyle(.secondary)
                    }
                    ForEach(selected) { item in agendaRow(item) }
                }
                let endOfDay = farmCalendar.date(byAdding: .day, value: 1, to: farmCalendar.startOfDay(for: store.calendarDay)) ?? store.calendarDay
                let upcoming = agenda.filter { ($0.date ?? .distantPast) >= max(endOfDay, .now) }
                if !upcoming.isEmpty {
                    Section(store.localized("வரவிருப்பவை", "Upcoming")) {
                        ForEach(upcoming) { item in agendaRow(item) }
                    }
                }

                let drafts = (store.state?.calendarEntries ?? []).filter { $0.status == "draft" }
                let review = (store.state?.tasks ?? []).filter { ["proposed", "postponed"].contains($0.status) }
                if !drafts.isEmpty || !review.isEmpty {
                    Section(store.localized("உங்கள் முடிவுக்காக", "Needs your review")) {
                        ForEach(drafts) { CalendarEntryCard(entry: $0, inCalendar: true) }
                        ForEach(review) { task in taskRow(task) }
                    }
                }
                let history = (store.state?.tasks ?? []).filter { ["completed", "rejected", "superseded"].contains($0.status) }
                if !history.isEmpty {
                    Section(store.localized("முந்தைய வேலைகள்", "Past farm tasks")) {
                        ForEach(history) { task in taskRow(task) }
                    }
                }
                if let notifications = store.state?.notifications, !notifications.isEmpty {
                    Section(store.localized("நினைவூட்டல்கள்", "Reminders")) {
                        ForEach(notifications.filter { !["cancelled", "expired"].contains($0.status) }) { notification in
                            VStack(alignment: .leading) {
                                Text(notification.title)
                                Text(store.dateLabel(notification.dueAt)).font(.caption)
                                Text(store.statusLabel(notification.status)).font(.caption)
                            }
                        }
                    }
                }
            }
            .onChange(of: store.selectedTaskID) { _, id in if let id { proxy.scrollTo(id, anchor: .top) } }
        }
        .navigationTitle(store.localized("நாள்காட்டி", "Calendar"))
        .sheet(item: $composer) { _ in ComposerView(calendarRequest: true) }
        .refreshable { await store.refresh() }
        .sheet(item: $decision) { selection in
            NavigationStack {
                Form {
                    Text(selection.task.title).font(.headline)
                    Text(selection.task.reason)
                    Text(selection.decision == "completed" ? store.localized("நீங்கள் செய்ததாக மட்டும் பதிவு செய்கிறோம். இது பழைய ஒப்புதலாக மாற்றப்படாது.", "This records that you did the task. It doesn't change any earlier approval.") : store.localized("இந்த வேலைக்கும் இந்தப் பதிப்புக்கும் மட்டும் உங்கள் முடிவைப் பதிவு செய்கிறோம். வெளியே எந்தச் செயலும் தானாக நடைபெறாது.", "This decision applies to this version of the task. No work is done automatically."))
                    Button(selection.label) {
                        Task {
                            if await store.mutate("/v1/tasks/\(selection.task.id)/decisions", body: ["requestId": selection.id.uuidString, "version": selection.task.version, "decision": selection.decision]) { decision = nil }
                        }
                    }.disabled(store.busy)
                    Button(store.localized("மீண்டும் பார்க்கவும்", "Go back")) { decision = nil }
                }.navigationTitle(store.localized("உங்கள் முடிவு", "Your decision"))
            }
        }
    }

    @ViewBuilder private func agendaRow(_ item: AgendaItem) -> some View {
        switch item {
        case .event(let entry): CalendarEntryCard(entry: entry, inCalendar: true).id(entry.id)
        case .task(let task): taskRow(task)
        }
    }

    private func taskRow(_ task: FarmTask) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(task.title).font(.headline)
            Text(store.dateLabel(task.dueAt)).font(.caption).foregroundStyle(.secondary)
            Text(task.reason)
            Text(store.statusLabel(task.status)).font(.subheadline.bold())
            ForEach(task.uncertainty, id: \.self) { Text($0).font(.caption).foregroundStyle(.secondary) }
            EvidenceList(ids: task.evidenceIds)
            if task.status == "proposed" {
                taskButton(task, "approved", store.localized("செய்ய ஒப்புக்கொள்கிறேன்", "Approve task"))
            }
            if task.status == "postponed" {
                Text(store.localized("புதிய தகவலுடன் திட்டத்தை மீண்டும் கேளுங்கள். பழைய ஒப்புதலை மீண்டும் பயன்படுத்த முடியாது.", "Ask for a new plan with the latest details. Earlier approval can't be reused.")).font(.caption).foregroundStyle(.secondary)
            }
            if ["proposed", "approved", "postponed"].contains(task.status) {
                taskButton(task, "completed", store.localized("செய்துவிட்டேன்", "Mark as done"))
                taskButton(task, "postponed", store.localized("பிறகு செய்யலாம்", "Postpone"))
                taskButton(task, "rejected", store.localized("வேண்டாம்", "Decline"), role: .destructive)
            }
        }.padding(.vertical, 6).buttonStyle(.borderless).id(task.id)
    }

    private func taskButton(_ task: FarmTask, _ value: String, _ label: String, role: ButtonRole? = nil) -> some View {
        Button(label, role: role) { decision = TaskDecision(task: task, decision: value, label: label) }
    }

    private enum AgendaItem: Identifiable {
        case event(CalendarEntry), task(FarmTask)
        var id: String {
            switch self { case .event(let item): item.id; case .task(let item): item.id }
        }
        var dueAt: String {
            switch self { case .event(let item): item.dueAt ?? ""; case .task(let item): item.dueAt }
        }
        var date: Date? { parseFarmDate(dueAt) }
    }

}

struct MyFarmView: View {
    private enum NotificationResult { case denied, scheduled, failed }
    @Environment(FarmStore.self) private var store
    @State private var exportURL: URL?
    @State private var confirmDelete = false
    @State private var notificationResult: NotificationResult?
    var body: some View {
        Form {
            Section(store.localized("பண்ணை விவரங்கள்", "Farm details")) {
                ForEach((store.state?.facts.keys.sorted() ?? []), id: \.self) { key in
                    LabeledContent(factLabel(key), value: store.state?.facts[key]?.text ?? "")
                }
                NavigationLink(store.localized("விவரங்களைத் திருத்தவும்", "Edit farm details")) { FarmFactsView(onboarding: false) }
            }
            Section(store.localized("மொழி மற்றும் ஒலி", "Language and audio")) {
                if store.enabledLanguages.count == 2 {
                    languagePicker.pickerStyle(.segmented)
                } else {
                    languagePicker.pickerStyle(.menu)
                }
                Text(store.localized("உள்ளூர் சொற்களைப் புரிந்துகொள்ள முயற்சிப்போம். புரியாதவற்றைக் கேட்டு உறுதி செய்வோம்.", "If we're unsure about a local term, we'll ask you to clarify.")).font(.caption).foregroundStyle(.secondary)
                Toggle(store.localized("ஒலியைச் செயலாக்க அனுமதி", "Allow audio processing"), isOn: Binding(get: { store.audioConsent }, set: { store.audioConsent = $0; store.saveDraft() }))
            }
            Section(store.localized("அறிவிப்புகள்", "Notifications")) {
                Toggle(store.localized("நினைவூட்டல்கள் வேண்டும்", "Enable reminders"), isOn: Binding(get: { store.state?.preferences.notifications ?? false }, set: { enabled in
                    Task { _ = await store.mutate("/v1/preferences", method: "PATCH", body: ["requestId": UUID().uuidString, "notifications": enabled]) }
                })).disabled(store.busy)
                if let preference = store.state?.preferences {
                    Picker(store.localized("அமைதி தொடங்கும் நேரம்", "Quiet hours start"), selection: Binding(get: { preference.quietStart }, set: { hour in
                        Task { _ = await store.mutate("/v1/preferences", method: "PATCH", body: ["requestId": UUID().uuidString, "quietStart": hour]) }
                    })) { ForEach(0..<24) { Text(String(format: "%02d:00", $0)).tag($0) } }.disabled(store.busy)
                    Picker(store.localized("அமைதி முடியும் நேரம்", "Quiet hours end"), selection: Binding(get: { preference.quietEnd }, set: { hour in
                        Task { _ = await store.mutate("/v1/preferences", method: "PATCH", body: ["requestId": UUID().uuidString, "quietEnd": hour]) }
                    })) { ForEach(0..<24) { Text(String(format: "%02d:00", $0)).tag($0) } }.disabled(store.busy)
                    Text(store.localized("இந்திய நேரம்", "India time")).font(.caption).foregroundStyle(.secondary)
                }
                Button(store.localized("சோதனை அறிவிப்பைப் பார்க்கவும்", "Try a test notification")) {
                    Task {
                        do {
                            let center = UNUserNotificationCenter.current()
                            guard try await center.requestAuthorization(options: [.alert, .sound]) else { notificationResult = .denied; return }
                            let content = UNMutableNotificationContent()
                            content.title = store.localized("சோதனை அறிவிப்பு", "Test notification")
                            content.body = store.localized("இது Simulator-இன் உள்ளூர் சோதனை மட்டுமே. பண்ணைக்கான நேரடி அறிவிப்பு அல்ல.", "This is a local Simulator test, not a live farm notification.")
                            content.sound = .default
                            if let id = store.state?.tasks.first?.id { content.userInfo = ["taskId": id] }
                            try await center.add(UNNotificationRequest(identifier: "local-demo", content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 5, repeats: false)))
                            notificationResult = .scheduled
                        } catch { notificationResult = .failed }
                    }
                }
                if let notificationResult { Text(notificationMessage(notificationResult)).font(.caption) }
                Text(store.localized("இந்த demo-வில் தொலைபேசிக்கான நேரடி push சேவை இணைக்கப்படவில்லை.", "This demo doesn't send live push notifications.")).font(.caption).foregroundStyle(.secondary)
            }
            Section(store.localized("உங்கள் தகவல்", "Your data")) {
                Button(store.localized("என் தகவலைப் பதிவிறக்கவும்", "Download my data")) {
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
                        } catch { store.error = store.localized("தகவலைப் பதிவிறக்க முடியவில்லை.", "Couldn't download your data.") }
                    }
                }
                if let exportURL { ShareLink(store.localized("என் தகவலைச் சேமிக்கவும் / பகிரவும்", "Save or share my data"), item: exportURL) }
                Text(store.localized("இந்தப் பதிவில் உங்கள் தனிப்பட்ட பண்ணைத் தகவல் இருக்கும். நம்பகமான இடத்தில் மட்டும் சேமிக்கவும்.", "This file contains private farm data. Save it only somewhere you trust.")).font(.caption).foregroundStyle(.secondary)
                Button(store.localized("என் தகவலை நீக்கவும்", "Delete my data"), role: .destructive) { confirmDelete = true }
                Button(store.localized("இந்தச் சாதனத்தின் இணைப்பை நீக்கவும்", "Disconnect this device")) { store.clearSession() }
            }
        }
        .navigationTitle(store.localized("என் பண்ணை", "My farm"))
        .confirmationDialog(store.localized("சேவையிலுள்ள உங்கள் தகவலை நீக்க வேண்டுமா? காப்புப்பிரதிகளுக்கான தனி சேமிப்புக் கொள்கை பொருந்தும்.", "Delete your data from the service? A separate retention policy applies to backups."), isPresented: $confirmDelete, titleVisibility: .visible) {
            Button(store.localized("நீக்கவும்", "Delete"), role: .destructive) {
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
    private var languagePicker: some View {
        Picker(store.localized("மொழி", "Language"), selection: Binding(get: { store.locale }, set: { locale in
            Task { await store.setLanguage(locale) }
        })) {
            ForEach(store.enabledLanguages, id: \.self) { code in
                Text(FarmStore.languageNames[code] ?? code).tag(code)
            }
        }
        .accessibilityIdentifier("languagePreference")
        .disabled(store.busy)
    }

    private func notificationMessage(_ result: NotificationResult) -> String {
        switch result {
        case .denied: store.localized("அறிவிப்பு அனுமதி இல்லை. அமைப்புகளில் மாற்றலாம்.", "Notifications aren't allowed. You can change this in Settings.")
        case .scheduled: store.localized("5 நொடிகளில் சோதனை அறிவிப்பு வரும்.", "The test notification will arrive in 5 seconds.")
        case .failed: store.localized("சோதனை அறிவிப்பை உருவாக்க முடியவில்லை.", "Couldn't schedule a test notification.")
        }
    }
    private func factLabel(_ key: String) -> String {
        switch key {
        case "village": store.localized("ஊர்", "Village")
        case "crop": store.localized("பயிர்", "Crop")
        case "district": store.localized("மாவட்டம்", "District")
        case "state": store.localized("மாநிலம்", "State")
        case "season": store.localized("பருவம்", "Season")
        case "soil": store.localized("மண்", "Soil")
        case "irrigation": store.localized("பாசனம்", "Irrigation")
        case "latitude": store.localized("அட்சரேகை", "Latitude")
        case "longitude": store.localized("தீர்க்கரேகை", "Longitude")
        case "sowingDate": store.localized("விதைத்த தேதி", "Sowing date")
        case "transplantDate": store.localized("நடவு செய்த தேதி", "Transplant date")
        case "datePrecision": store.localized("தேதியின் துல்லியம்", "Date precision")
        case "concern": store.localized("கவலை", "Concern")
        default: key
        }
    }
}
