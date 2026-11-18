import Foundation
import Security

struct APIClient {
    let baseURL: URL
    let token: String
    private static let session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 45
        config.timeoutIntervalForResource = 120
        config.urlCache = nil
        return URLSession(configuration: config)
    }()
    func request(_ path: String, method: String = "GET", body: [String: Any]? = nil) throws -> URLRequest {
        guard let url = URL(string: path, relativeTo: baseURL) else { throw URLError(.badURL) }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return request
    }
    func data(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Data {
        let (data, response) = try await Self.session.data(for: request(path, method: method, body: body))
        try validate(response, data: data)
        return data
    }
    func getState() async throws -> FarmerState {
        try JSONDecoder().decode(FarmerState.self, from: await data("/v1/state"))
    }
    func mutate(_ path: String, method: String = "POST", body: [String: Any]) async throws {
        _ = try await data(path, method: method, body: body)
    }
    func upload(_ audio: Data, requestId: String) async throws -> String {
        var request = try request("/v1/audio", method: "POST")
        request.httpBody = audio
        request.setValue("audio/mp4", forHTTPHeaderField: "Content-Type")
        request.setValue(requestId, forHTTPHeaderField: "Idempotency-Key")
        let (data, response) = try await Self.session.data(for: request)
        try validate(response, data: data)
        return try JSONDecoder().decode(AudioReceipt.self, from: data).audioId
    }
    func events(after sequence: Int, receive: @escaping @MainActor () async -> Void) async throws {
        var request = try request("/v1/events?after=\(sequence)")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 60
        let (bytes, response) = try await Self.session.bytes(for: request)
        try validate(response, data: Data())
        for try await line in bytes.lines {
            try Task.checkCancellation()
            if line.hasPrefix("data:") { await receive() }
        }
    }
    private func validate(_ response: URLResponse, data: Data) throws {
        guard let response = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        guard (200..<300).contains(response.statusCode) else {
            let json = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
            let error = json?["error"] as? [String: String]
            throw APIError(status: response.statusCode, code: error?["code"] ?? "HTTP_\(response.statusCode)", message: error?["message"] ?? "")
        }
    }
}

enum SessionKeychain {
    private static let service = "local.farm-assistant.session"
    static func read() -> String {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecReturnData as String: true, kSecMatchLimit as String: kSecMatchLimitOne]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
              let data = result as? Data else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }
    static func save(_ token: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service]
        SecItemDelete(query as CFDictionary)
        guard !token.isEmpty else { return }
        var entry = query
        entry[kSecValueData as String] = Data(token.utf8)
        entry[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
        let status = SecItemAdd(entry as CFDictionary, nil)
        guard status == errSecSuccess else { throw NSError(domain: NSOSStatusErrorDomain, code: Int(status)) }
    }
}
