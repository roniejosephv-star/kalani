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
    private var acceptedSequence = -1
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
            catch { self.error = "சோதனை இணைப்பை அமைக்க முடியவில்லை. Keychain: \((error as NSError).code)" }
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
    func configure(url: String, token: String) throws {
        guard let parsed = URL(string: url), parsed.user == nil, parsed.password == nil,
              parsed.scheme == "https" || (parsed.scheme == "http" && ["127.0.0.1", "localhost", "::1"].contains(parsed.host ?? "")) else {
            throw APIError(status: 400, code: "HTTPS_OR_LOCALHOST_REQUIRED", message: "")
        }
        try SessionKeychain.save(token.trimmingCharacters(in: .whitespacesAndNewlines))
        self.baseURL = url.trimmingCharacters(in: .whitespacesAndNewlines)
        self.token = token.trimmingCharacters(in: .whitespacesAndNewlines)
        UserDefaults.standard.set(self.baseURL, forKey: "serverURL")
        state = nil
        acceptedSequence = -1
        sessionID = UUID()
        loadDraft()
    }
    func runConnection() async {
        guard let client else { return }
        loadDraft()
        while !Task.isCancelled {
            do {
                await refresh()
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
            if updated.sequence >= acceptedSequence {
                acceptedSequence = updated.sequence
                state = updated
            }
            connected = true
        } catch {
            if identity == sessionID && !Task.isCancelled { connected = false; self.error = message(for: error) }
        }
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
                self.error = "பண்ணை விவரங்கள் மாறியுள்ளன. புதிய தகவலுடன் ஒரு புதிய கேள்வியை அனுப்பவும்."
            } else { self.error = message(for: error) }
            return false
        }
    }
    func sendDraft() async -> Bool {
        guard let client, let state, !busy, !draft.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.hasAudio else { return false }
        if draft.hasAudio && !audioConsent { error = "ஒலியை அனுப்ப முன் உங்கள் அனுமதி தேவை."; return false }
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
        } catch { self.error = "வரைவைச் சேமிக்க முடியவில்லை. பயன்பாட்டை மூடுவதற்கு முன் மீண்டும் முயற்சிக்கவும்." }
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
        state = nil
        token = ""
        draft = MessageDraft()
        acceptedSequence = -1
        sessionID = UUID()
    }
    func message(for error: Error) -> String {
        if let error = error as? APIError { return error.localizedDescription }
        return "இணைக்க முடியவில்லை. இணையம் மற்றும் சேவை இணைப்பைச் சரிபார்க்கவும். உங்கள் வரைவு பாதுகாக்கப்பட்டுள்ளது."
    }
}
