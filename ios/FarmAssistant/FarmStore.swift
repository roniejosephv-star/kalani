import Foundation
import Observation
import CryptoKit

struct MessageDraft: Codable {
    var text = ""
    var requestId = UUID().uuidString
    var uploadId = UUID().uuidString
    var hasAudio = false
    var audioId: String?
    var attempted = false
}

@MainActor @Observable final class FarmStore {
    var state: FarmerState?
    var error: String?
    var busy = false
    var connecting = false
    var connected = false
    var baseURL = UserDefaults.standard.string(forKey: "serverURL") ?? "http://127.0.0.1:8787"
    private(set) var token = SessionKeychain.read()
    var sessionID = UUID()
    var draft = MessageDraft()
    var audioConsent = false
    var selectedTab = 0
    var selectedTaskID: String?
    var calendarDay = farmCalendar.startOfDay(for: .now)
    var locale = UserDefaults.standard.string(forKey: "farmLanguage") ?? "ta-IN"
    var languageChosen = UserDefaults.standard.string(forKey: "farmLanguage") != nil || UserDefaults.standard.bool(forKey: "selectedTamil")
    private(set) var pendingLanguage = UserDefaults.standard.string(forKey: "pendingFarmLanguage")
    private var acceptedSequence = -1
    private var languageRequest: (choice: String, id: String)?
    init() {
        #if DEBUG
        let environment = ProcessInfo.processInfo.environment
        if let demoToken = environment["FARM_SESSION_TOKEN"], !demoToken.isEmpty {
            do {
                try configure(url: environment["FARM_API_URL"] ?? "http://127.0.0.1:8787", token: demoToken)
                #if targetEnvironment(simulator)
                if let encoded = environment["FARM_UI_TEST_AUDIO"], let data = Data(base64Encoded: encoded) {
                    try prepareDirectory()
                    try data.write(to: recordingURL, options: [.atomic, .completeFileProtection])
                    draft = MessageDraft(hasAudio: true)
                    saveDraft()
                }
                #endif
            }
            catch { self.error = localized("சோதனை இணைப்பை அமைக்க முடியவில்லை.", "Could not set up the test connection.") }
        }
        #endif
    }
    var client: APIClient? {
        guard !token.isEmpty, let url = URL(string: baseURL),
              url.scheme == "https" || (url.scheme == "http" && ["127.0.0.1", "localhost", "::1"].contains(url.host ?? "")) else { return nil }
        return APIClient(baseURL: url, token: token)
    }
    var localDirectory: URL {
        let hash = SHA256.hash(data: Data(token.utf8)).map { String(format: "%02x", $0) }.joined()
        return FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent(hash, isDirectory: true)
    }
    var recordingURL: URL { localDirectory.appendingPathComponent("draft.m4a") }
    var needsOnboarding: Bool { state?.facts["crop"] == nil || state?.facts["village"] == nil }
    static let languageNames = ["en-IN": "English", "ta-IN": "தமிழ்", "kn-IN": "ಕನ್ನಡ", "ml-IN": "മലയാളം", "te-IN": "తెలుగు"]
    var enabledLanguages: [String] {
        (state?.enabledLanguages ?? ["en-IN", "ta-IN"]).filter { Self.languageNames[$0] != nil }
    }
    func localized(_ tamil: String, _ english: String) -> String {
        if locale == "ta-IN" { return tamil }
        return PilotLocalization.text(english, locale: locale) ?? english
    }
    func chooseInitialLanguage(_ choice: String) {
        pendingLanguage = choice
        UserDefaults.standard.set(choice, forKey: "pendingFarmLanguage")
        rememberLanguage(choice)
    }
    func setLanguage(_ choice: String) async {
        guard let client, !busy, state != nil, enabledLanguages.contains(choice),
              choice != state?.preferences.locale || pendingLanguage != nil else { return }
        let requestId = languageRequest?.choice == choice ? languageRequest?.id ?? UUID().uuidString : UUID().uuidString
        languageRequest = (choice, requestId)
        let identity = sessionID
        busy = true
        defer { busy = false }
        do {
            let data = try await client.data("/v1/preferences", method: "PATCH", body: ["requestId": requestId, "locale": choice])
            let updated = try JSONDecoder().decode(FarmerState.self, from: data)
            guard identity == sessionID else { return }
            clearPendingLanguage()
            accept(updated)
            languageRequest = nil
            error = nil
        } catch {
            guard identity == sessionID else { return }
            self.error = localized("மொழியை மாற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.", "Could not change the language. Select it again to retry.")
        }
    }
    private func clearPendingLanguage() {
        pendingLanguage = nil
        UserDefaults.standard.removeObject(forKey: "pendingFarmLanguage")
    }
    private func rememberLanguage(_ choice: String) {
        guard Self.languageNames[choice] != nil else { return }
        locale = choice
        languageChosen = true
        UserDefaults.standard.set(locale, forKey: "farmLanguage")
    }
    func configure(url: String, token: String) throws {
        guard let parsed = URL(string: url), parsed.user == nil, parsed.password == nil,
              parsed.scheme == "https" || (parsed.scheme == "http" && ["127.0.0.1", "localhost", "::1"].contains(parsed.host ?? "")) else {
            throw APIError(status: 400, code: "HTTPS_OR_LOCALHOST_REQUIRED", message: "")
        }
        let nextURL = url.trimmingCharacters(in: .whitespacesAndNewlines)
        let nextToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
        try SessionKeychain.save(nextToken)
        if !self.token.isEmpty && (self.token != nextToken || baseURL != nextURL) {
            clearPendingLanguage()
        }
        self.baseURL = nextURL
        self.token = nextToken
        UserDefaults.standard.set(self.baseURL, forKey: "serverURL")
        state = nil
        acceptedSequence = -1
        languageRequest = nil
        calendarDay = farmCalendar.startOfDay(for: .now)
        sessionID = UUID()
        loadDraft()
    }
    func runConnection() async {
        guard let client else { return }
        loadDraft()
        while !Task.isCancelled {
            do {
                await refresh()
                if let pendingLanguage { await setLanguage(pendingLanguage) }
                try await client.events(after: state?.sequence ?? 0) { [weak self] in await self?.refresh() }
            } catch is CancellationError { return }
            catch {
                if Task.isCancelled { return }
                connected = false
                if state == nil { self.error = message(for: error) }
            }
            try? await Task.sleep(for: .seconds(5))
        }
    }
    func refresh() async {
        guard let client else { return }
        let identity = sessionID
        connecting = state == nil
        defer { connecting = false }
        do {
            let updated = try await client.getState()
            guard identity == sessionID, !Task.isCancelled else { return }
            accept(updated)
            connected = true
        } catch {
            if identity == sessionID && !Task.isCancelled { connected = false; self.error = message(for: error) }
        }
    }
    private func accept(_ updated: FarmerState) {
        guard updated.sequence >= acceptedSequence else { return }
        acceptedSequence = updated.sequence
        state = updated
        if let pendingLanguage, !enabledLanguages.contains(pendingLanguage) {
            clearPendingLanguage()
        }
        if languageChosen && pendingLanguage == nil && locale != updated.preferences.locale {
            rememberLanguage(updated.preferences.locale)
        }
    }
    func showCalendar(on date: Date) {
        calendarDay = farmCalendar.startOfDay(for: date)
        selectedTab = 2
    }
    func calendarAction(_ action: String, for entry: CalendarEntry, dueAt: Date? = nil) async -> Bool {
        let time = dueAt.map { ISO8601DateFormatter().string(from: $0) }
        let intent = "\(entry.id)/\(entry.version)/\(action)/\(time ?? "")"
        let requestId = SHA256.hash(data: Data(intent.utf8)).map { String(format: "%02x", $0) }.joined()
        var body: [String: Any] = [
            "requestId": requestId,
            "version": entry.version, "action": action
        ]
        if let time { body["dueAt"] = time }
        return await mutate("/v1/calendar/\(entry.id)/actions", body: body)
    }
    func mutate(_ path: String, method: String = "POST", body: [String: Any]) async -> Bool {
        guard let client, !busy else { return false }
        let identity = sessionID
        busy = true
        defer { busy = false }
        do {
            try await client.mutate(path, method: method, body: body)
            guard identity == sessionID else { return false }
            await refresh()
            error = nil
            return true
        } catch {
            self.error = message(for: error)
            if (error as? APIError)?.status == 409 { await refresh() }
            return false
        }
    }
    func retryMessage(_ id: String, requestId: String) async -> Bool {
        guard let client, !busy else { return false }
        let identity = sessionID
        busy = true
        defer { busy = false }
        do {
            try await client.mutate("/v1/messages/\(id)/retry", body: ["requestId": requestId])
            guard identity == sessionID else { return false }
            await refresh()
            error = nil
            return true
        } catch {
            guard identity == sessionID else { return false }
            if (error as? APIError)?.status == 409 {
                await refresh()
                self.error = localized("பண்ணை விவரங்கள் மாறியுள்ளன. புதிய தகவலுடன் ஒரு புதிய கேள்வியை அனுப்பவும்.", "The farm details changed. Send a new question with the updated details.")
            } else { self.error = message(for: error) }
            return false
        }
    }
    func sendDraft() async -> Bool {
        guard let client, let state, pendingLanguage == nil, !busy, !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.hasAudio else { return false }
        if draft.hasAudio && !audioConsent { error = localized("ஒலியை அனுப்ப முன் உங்கள் அனுமதி தேவை.", "Please allow audio processing before sending a recording."); return false }
        let identity = sessionID
        busy = true
        draft.attempted = true
        saveDraft()
        defer { busy = false }
        do {
            if draft.hasAudio && draft.audioId == nil {
                let audioId = try await client.upload(Data(contentsOf: recordingURL), requestId: draft.uploadId)
                guard identity == sessionID else { return false }
                draft.audioId = audioId
                saveDraft()
            }
            var body: [String: Any] = ["requestId": draft.requestId, "fieldId": state.fieldId, "cycleId": state.cycleId]
            if let audioId = draft.audioId { body["audioId"] = audioId }
            else { body["text"] = draft.text }
            try await client.mutate("/v1/messages", body: body)
            guard identity == sessionID else { return false }
            discardDraft()
            await refresh()
            error = nil
            return true
        } catch {
            self.error = message(for: error)
            return false
        }
    }
    func discardDraft() {
        draft = MessageDraft()
        try? FileManager.default.removeItem(at: recordingURL)
        saveDraft()
    }
    func saveDraft() {
        do {
            try prepareDirectory()
            try JSONEncoder().encode(draft).write(to: localDirectory.appendingPathComponent("draft.json"), options: [.atomic, .completeFileProtection])
            try Data((audioConsent ? "yes" : "no").utf8).write(to: localDirectory.appendingPathComponent("audio-consent"), options: [.atomic, .completeFileProtection])
        } catch { self.error = localized("வரைவைச் சேமிக்க முடியவில்லை. பயன்பாட்டை மூடுவதற்கு முன் மீண்டும் முயற்சிக்கவும்.", "Could not save your draft. Try again before closing the app.") }
    }
    func prepareDirectory() throws {
        try FileManager.default.createDirectory(at: localDirectory, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.complete])
        var url = localDirectory
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        try url.setResourceValues(values)
    }
    func loadDraft() {
        draft = (try? JSONDecoder().decode(MessageDraft.self, from: Data(contentsOf: localDirectory.appendingPathComponent("draft.json")))) ?? MessageDraft()
        if draft.hasAudio && !FileManager.default.fileExists(atPath: recordingURL.path) { draft.hasAudio = false }
        audioConsent = (try? String(contentsOf: localDirectory.appendingPathComponent("audio-consent"), encoding: .utf8)) == "yes"
    }
    func clearSession() {
        try? SessionKeychain.save("")
        clearPendingLanguage()
        state = nil
        token = ""
        draft = MessageDraft()
        acceptedSequence = -1
        languageRequest = nil
        calendarDay = farmCalendar.startOfDay(for: .now)
        sessionID = UUID()
    }
    func message(for error: Error) -> String {
        if let error = error as? APIError {
            switch error.code {
            case "calendar_time_conflict":
                return localized("அந்த நேரத்தில் வேறு வேலை உள்ளது. வேறு நேரத்தைத் தேர்ந்தெடுக்கவும்.", "Something is already scheduled then. Choose another time.")
            case "invalid_calendar_time":
                return localized("இனிமேல் வரும் தேதியையும் நேரத்தையும் தேர்ந்தெடுக்கவும்.", "Choose a future date and time.")
            default: break
            }
            switch error.status {
            case 401, 403: return localized("இணைப்பு அனுமதியைச் சரிபார்க்கவும். மீண்டும் இணைக்கவும்.", "Check your farm connection code and reconnect.")
            case 409: return localized("விவரங்கள் மாறியுள்ளன. புதிய விவரங்களைப் பார்த்து மீண்டும் உறுதி செய்யவும்.", "Details have changed. Review the latest details and confirm again.")
            case 503: return localized("சேவை இப்போது கிடைக்கவில்லை. உங்கள் செய்தியை மீண்டும் முயற்சிக்கலாம்.", "The service is unavailable. You can retry your message.")
            default: return serviceError(error.code)
            }
        }
        return localized("இணைக்க முடியவில்லை. இணையம் மற்றும் சேவை இணைப்பைச் சரிபார்க்கவும். உங்கள் வரைவு பாதுகாக்கப்பட்டுள்ளது.", "Could not connect. Check the connection and try again. Your draft is saved.")
    }
}
