import Foundation

struct FarmerState: Decodable {
    let version: Int
    let facts: [String: FactValue]
    let fieldId: String
    let cycleId: String
    let preferences: Preferences
    let messages: [FarmMessage]
    let tasks: [FarmTask]
    let evidence: [Evidence]
    let notifications: [FarmNotification]
    let sequence: Int
}

enum FactValue: Decodable {
    case text(String), number(Double)
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if let number = try? value.decode(Double.self) { self = .number(number) }
        else { self = .text(try value.decode(String.self)) }
    }
    var text: String {
        switch self { case .text(let value): return value; case .number(let value): return String(value) }
    }
}
struct Preferences: Decodable { let locale: String; let notifications: Bool; let quietStart: Int; let quietEnd: Int }
struct FarmMessage: Decodable, Identifiable {
    let id: String
    let role: String
    let text: String
    let audioId: String?
    let status: String
    let audioStatus: String?
    let createdAt: String
    let error: String?
    let evidenceIds: [String]?
    let proposedFacts: [String: FactValue]?
}
struct FarmTask: Decodable, Identifiable {
    let id: String
    let version: Int
    let title: String
    let reason: String
    let status: String
    let dueAt: String
    let evidenceIds: [String]
    let uncertainty: [String]
    let fieldId: String
    let cycleId: String
}
struct Evidence: Decodable, Identifiable {
    let id: String
    let source: String
    let url: String
    let retrievedAt: String
    let observedAt: String?
    let validUntil: String?
    let title: String?
    let passage: String?
}
struct FarmNotification: Decodable, Identifiable {
    let id: String
    let status: String
    let title: String
    let dueAt: String
    let taskId: String?
}
struct MessageReceipt: Decodable { let messageId: String }
struct AudioReceipt: Decodable { let audioId: String }
struct APIError: Error {
    let status: Int
    let code: String
    let message: String

}
func tamilServiceError(_ code: String) -> String {
    switch code {
    case "claude_unconfigured", "model_unavailable":
        return "பதில் தயாரிக்கும் சேவை இப்போது கிடைக்கவில்லை. உங்கள் செய்தி சேமிக்கப்பட்டுள்ளது. பின்னர் மீண்டும் முயற்சிக்கலாம்."
    case "transcription_unavailable":
        return "ஒலிப்பதிவை எழுத்தாக மாற்ற முடியவில்லை. மீண்டும் முயற்சிக்கலாம் அல்லது கேள்வியை எழுதலாம்."
    case "audio_missing":
        return "உங்கள் ஒலிப்பதிவு கிடைக்கவில்லை. மீண்டும் பதிவு செய்து புதிய செய்தியாக அனுப்பவும்."
    case "invalid_model_output", "invalid_specialist_output":
        return "கிடைத்த தகவலை உறுதி செய்ய முடியவில்லை. இன்னும் வழிகாட்டல் வழங்கப்படவில்லை. மீண்டும் முயற்சிக்கலாம்."
    case "busy":
        return "முந்தைய செய்திகளுக்குப் பதில் தயாராகிறது. சிறிது நேரம் காத்திருக்கவும்."
    default:
        return "செயலாக்கத்தை முடிக்க முடியவில்லை. பின்னர் மீண்டும் முயற்சிக்கலாம்."
    }
}
func tamilStatus(_ status: String) -> String {
    switch status {
    case "queued": return "வரிசையில் உள்ளது"
    case "processing": return "பதில் தயாராகிறது"
    case "ready": return "தயார்"
    case "failed": return "மீண்டும் முயற்சிக்கவும்"
    case "unconfigured": return "ஒலி சேவை இன்னும் இணைக்கப்படவில்லை"
    case "pending": return "ஒலி தயாராகிறது"
    case "proposed": return "உங்கள் முடிவுக்காக"
    case "approved": return "செய்ய ஒப்புக்கொண்டீர்கள்"
    case "completed": return "செய்ததாகப் பதிவு செய்தீர்கள்"
    case "postponed": return "ஒத்திவைக்கப்பட்டது"
    case "rejected": return "வேண்டாம் என்று கூறினீர்கள்"
    case "superseded": return "புதிய தகவலால் மாற்றப்பட்டது"
    case "accepted": return "பயன்பாட்டில் சேர்க்கப்பட்டது"
    case "dispatching": return "அனுப்புகிறது"
    case "uncertain": return "அனுப்பிய நிலையை உறுதி செய்ய வேண்டும்"
    case "cancelled": return "ரத்து செய்யப்பட்டது"
    case "expired": return "காலம் கடந்துவிட்டது"
    default: return status
    }
}
func displayDate(_ value: String, locale: String) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let date = formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    guard let date else { return value }
    let output = DateFormatter()
    output.locale = Locale(identifier: locale)
    output.dateStyle = .medium
    output.timeStyle = .short
    return output.string(from: date)
}

@MainActor extension FarmStore {
    func dateLabel(_ value: String) -> String { displayDate(value, locale: locale) }

    func audioError(_ error: AudioController.AudioError) -> String {
        switch error {
        case .permission: return localized("மைக்ரோஃபோன் அனுமதி இல்லை. அமைப்புகளில் அனுமதிக்கலாம் அல்லது எழுதிப் பதில் சொல்லலாம்.", "Microphone access is off. Allow it in Settings or type your question.")
        case .record: return localized("ஒலியைப் பதிவு செய்ய முடியவில்லை. மீண்டும் முயற்சிக்கவும்.", "Could not record audio. Try again.")
        case .play: return localized("ஒலியை இயக்க முடியவில்லை. எழுத்துப் பதிலைப் பார்க்கலாம்.", "Could not play audio. You can read the reply.")
        case .interrupted: return localized("பதிவு இடையில் நின்றுவிட்டது. கேட்டு சரிபார்த்து அனுப்பவும்.", "Recording was interrupted. Listen and check it before sending.")
        }
    }

    func serviceError(_ code: String) -> String {
        guard locale == "en-IN" else { return tamilServiceError(code) }
        switch code {
        case "claude_unconfigured", "model_unavailable": return "The reply service is unavailable. Your message is saved. Try again later."
        case "transcription_unavailable": return "Could not transcribe the recording. Try again or type your question."
        case "audio_missing": return "Your recording is unavailable. Record and send a new message."
        case "invalid_model_output", "invalid_specialist_output": return "We could not verify the information, so guidance was not published. Try again."
        case "busy": return "Earlier messages are still being processed. Please wait."
        default: return "Could not finish processing. Try again later."
        }
    }

    func statusLabel(_ status: String) -> String {
        guard locale == "en-IN" else { return tamilStatus(status) }
        return [
            "queued": "Queued", "processing": "Preparing your reply", "ready": "Ready",
            "failed": "Try again", "unconfigured": "Audio service is unavailable", "pending": "Preparing audio",
            "proposed": "Awaiting your decision", "approved": "Approved", "completed": "Reported complete",
            "postponed": "Postponed", "rejected": "Declined", "superseded": "Replaced by newer guidance",
            "accepted": "Added to the app", "dispatching": "Sending", "uncertain": "Delivery needs checking",
            "cancelled": "Cancelled", "expired": "Expired"
        ][status] ?? status
    }
}
