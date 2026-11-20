import Foundation

enum PilotLocalization {
    static func text(_ english: String, locale: String) -> String? {
        guard ["kn-IN", "ml-IN", "te-IN"].contains(locale) else { return nil }
        return strings[english]?[locale]
    }

    private static let strings: [String: [String: String]] = {
        guard let url = Bundle.main.url(forResource: "PilotStrings", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let translations = try? JSONDecoder().decode([String: [String: String]].self, from: data) else {
            return [:]
        }
        return translations
    }()
}
