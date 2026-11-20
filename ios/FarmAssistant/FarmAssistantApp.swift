import SwiftUI
import UserNotifications

@main
struct FarmAssistantApp: App {
    @UIApplicationDelegateAdaptor(NotificationDelegate.self) private var delegate
    @State private var store = FarmStore()
    @State private var audio = AudioController()
    @Environment(\.scenePhase) private var phase
    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(store)
                .environment(audio)
                .task(id: "\(store.sessionID)-\(phase)") {
                    guard phase == .active else { return }
                    await store.runConnection()
                }
                .onChange(of: store.sessionID) { _, _ in audio.stopRecording(); audio.stopPlayback() }
                .onChange(of: phase) { _, phase in
                    if phase != .active { audio.stopRecording(); audio.stopPlayback(); store.saveDraft() }
                }
                .onReceive(NotificationCenter.default.publisher(for: .farmNotificationOpened)) { item in
                    let id = item.userInfo?["taskId"] as? String
                    let date = store.state?.calendarEntries?.first(where: { $0.id == id })?.date
                        ?? store.state?.tasks.first(where: { $0.id == id }).flatMap { parseFarmDate($0.dueAt) }
                    store.showCalendar(on: date ?? .now)
                    store.selectedTaskID = id
                }
        }
    }
}
extension Notification.Name { static let farmNotificationOpened = Notification.Name("farmNotificationOpened") }
final class NotificationDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        await MainActor.run {
            NotificationCenter.default.post(name: .farmNotificationOpened, object: nil, userInfo: response.notification.request.content.userInfo)
        }
    }
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions { [.banner, .sound] }
}

struct RootView: View {
    @Environment(FarmStore.self) private var store
    var body: some View {
        @Bindable var store = store
        Group {
            if !store.languageChosen {
                VStack(spacing: 24) {
                    Image(systemName: "leaf").font(.system(size: 52)).foregroundStyle(.green)
                    Text("Kalani").font(.largeTitle.bold())
                    Text("A Farmer’s Assistant").font(.title3)
                    Text("Choose your language · மொழியைத் தேர்ந்தெடுக்கவும்").multilineTextAlignment(.center)
                    Button("தமிழில் தொடரவும்") { selectLanguage("ta-IN") }.accessibilityIdentifier("chooseTamil")
                    Button("Continue in English") { selectLanguage("en-IN") }.accessibilityIdentifier("chooseEnglish")
                    ForEach(store.enabledLanguages.filter { !["en-IN", "ta-IN"].contains($0) }, id: \.self) { code in
                        Button(FarmStore.languageNames[code] ?? code) { selectLanguage(code) }
                    }
                }.buttonStyle(.borderedProminent).controlSize(.large).padding(28)
            } else if store.client == nil { ConnectionView() }
            else if store.state == nil {
                VStack(spacing: 20) {
                    if store.connecting { ProgressView(store.localized("இணைக்கிறது…", "Connecting…")) }
                    else { ContentUnavailableView(store.localized("இணைக்க முடியவில்லை", "Could not connect"), systemImage: "wifi.slash", description: Text(store.localized("சேவை இயங்குகிறதா என்று சரிபார்த்து மீண்டும் முயற்சிக்கவும்.", "Check that the service is running and try again."))) }
                    Button(store.localized("மீண்டும் முயற்சி", "Try again")) { Task { await store.refresh() } }
                    Button(store.localized("இணைப்பை மாற்றவும்", "Change connection")) { store.clearSession() }
                }.padding()
            } else if let pending = store.pendingLanguage {
                VStack(spacing: 20) {
                    if store.busy {
                        ProgressView(store.localized("மொழியை அமைக்கிறது…", "Setting your language…"))
                    } else {
                        Button(store.localized("மொழியை அமைக்கவும்", "Set language")) { Task { await store.setLanguage(pending) } }
                        Button(store.localized("இணைப்பை மாற்றவும்", "Change connection")) { store.clearSession() }
                    }
                }.padding()
            } else if store.needsOnboarding {
                NavigationStack {
                    FarmFactsView(onboarding: true)
                        .toolbar { LanguageMenu() }
                }
            } else {
                TabView(selection: $store.selectedTab) {
                    NavigationStack { TodayView().toolbar { LanguageMenu() } }.tabItem { Label(store.localized("இன்று", "Today"), systemImage: "sun.max") }.tag(0)
                    NavigationStack { ConversationView().toolbar { LanguageMenu() } }.tabItem { Label(store.localized("உரையாடல்", "Conversation"), systemImage: "bubble.left.and.bubble.right") }.tag(1)
                    NavigationStack { WeekView().toolbar { LanguageMenu() } }.tabItem { Label(store.localized("நாள்காட்டி", "Calendar"), systemImage: "calendar") }.tag(2)
                    NavigationStack { MyFarmView().toolbar { LanguageMenu() } }.tabItem { Label(store.localized("என் பண்ணை", "My Farm"), systemImage: "leaf") }.tag(3)
                }
            }
        }
        .tint(.green)
        .environment(\.locale, Locale(identifier: store.locale))
        .alert(store.localized("தகவல்", "Information"), isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button(store.localized("சரி", "OK")) { store.error = nil }
        } message: { Text(store.error ?? "") }
    }
    private func selectLanguage(_ locale: String) {
        store.chooseInitialLanguage(locale)
        Task { await store.setLanguage(locale) }
    }
}

struct LanguageMenu: View {
    @Environment(FarmStore.self) private var store
    var body: some View {
        Group {
            if store.enabledLanguages.count == 2 {
                Picker(store.localized("மொழி", "Language"), selection: Binding(get: { store.locale }, set: select)) {
                    ForEach(store.enabledLanguages, id: \.self) { code in
                        Text(FarmStore.languageNames[code] ?? code).tag(code)
                    }
                }
                .pickerStyle(.segmented)
                .frame(minWidth: 135)
            } else {
                Menu {
                    ForEach(store.enabledLanguages, id: \.self) { code in
                        Button {
                            select(code)
                        } label: {
                            if code == store.locale {
                                Label(FarmStore.languageNames[code] ?? code, systemImage: "checkmark")
                            } else {
                                Text(FarmStore.languageNames[code] ?? code)
                            }
                        }
                    }
                } label: {
                    Label(FarmStore.languageNames[store.locale] ?? store.locale, systemImage: "globe")
                }
                .accessibilityHint(store.localized("மொழியை மாற்றவும்", "Change language"))
            }
        }
        .accessibilityIdentifier("navigationLanguage")
        .disabled(store.busy)
    }
    private func select(_ locale: String) {
        if store.state == nil { store.chooseInitialLanguage(locale) }
        else { Task { await store.setLanguage(locale) } }
    }
}

struct ConnectionView: View {
    @Environment(FarmStore.self) private var store
    @State private var url = "http://127.0.0.1:8787"
    @State private var token = ""
    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(store.localized("உங்கள் பண்ணையின் பாதுகாப்பான இணைப்பு", "Connect securely to your farm")).font(.headline)
                    Text(store.localized("முதல் முறையில் மட்டும் இந்த இணைப்பை அமைக்க வேண்டும். உங்கள் உதவியாளரின் உதவியையும் பெறலாம்.", "Set this up once. A trusted helper can assist you."))
                }
                Section(store.localized("இணைப்பு அமைப்பு · உள்ளூர் சோதனை", "Connection setup · Local demo")) {
                    TextField(store.localized("சேவை முகவரி", "Service address"), text: $url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("serverURL")
                    SecureField(store.localized("பண்ணைக்கான இணைப்புக் குறியீடு", "Farm connection code"), text: $token).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("sessionToken")
                    Text(store.localized("இது பண்ணைக்கான தனிப்பட்ட குறியீடு. Claude அல்லது speech API key இங்கு தேவையில்லை.", "Use your private farm connection code. Provider API keys are handled by the service.")).font(.caption).foregroundStyle(.secondary)
                    Button(store.localized("இணைக்கவும்", "Connect")) {
                        do { try store.configure(url: url, token: token) }
                        catch { store.error = store.localized("முகவரியைச் சரிபார்க்கவும். HTTPS அல்லது இந்த Mac-இன் localhost இணைப்பைப் பயன்படுத்தவும்.", "Check the address. Use HTTPS or the local connection on this Mac.") }
                    }.disabled(token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("connect")
                }
            }.navigationTitle("Kalani").toolbar { LanguageMenu() }
        }.onAppear { url = store.baseURL }
    }
}
