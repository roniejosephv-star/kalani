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
                    store.selectedTaskID = item.userInfo?["taskId"] as? String
                    store.selectedTab = 2
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
    @AppStorage("selectedTamil") private var selectedTamil = false
    var body: some View {
        @Bindable var store = store
        Group {
            if store.client == nil { ConnectionView() }
            else if !selectedTamil {
                VStack(spacing: 28) {
                    Image(systemName: "leaf").font(.system(size: 52)).foregroundStyle(.green)
                    Text("வணக்கம்").font(.largeTitle.bold())
                    Text("உங்கள் பண்ணைக்கு உதவும் வழிகாட்டி").font(.title3).multilineTextAlignment(.center)
                    Button("தமிழில் தொடரவும்") { selectedTamil = true }.buttonStyle(.borderedProminent).controlSize(.large)
                    Text("தமிழில் பேசலாம், கேட்கலாம், திருத்தலாம்.").foregroundStyle(.secondary)
                }.padding(28)
            } else if store.state == nil {
                VStack(spacing: 20) {
                    if store.connecting { ProgressView("இணைக்கிறது…") }
                    else { ContentUnavailableView("இணைக்க முடியவில்லை", systemImage: "wifi.slash", description: Text("சேவை இயங்குகிறதா என்று சரிபார்த்து மீண்டும் முயற்சிக்கவும்.")) }
                    Button("மீண்டும் முயற்சி") { Task { await store.refresh() } }
                    Button("இணைப்பை மாற்றவும்") { store.clearSession() }
                }.padding()
            } else if store.needsOnboarding {
                NavigationStack { FarmFactsView(onboarding: true) }
            } else {
                TabView(selection: $store.selectedTab) {
                    NavigationStack { TodayView() }.tabItem { Label("இன்று", systemImage: "sun.max") }.tag(0)
                    NavigationStack { ConversationView() }.tabItem { Label("உரையாடல்", systemImage: "bubble.left.and.bubble.right") }.tag(1)
                    NavigationStack { WeekView() }.tabItem { Label("இந்த வாரம்", systemImage: "calendar") }.tag(2)
                    NavigationStack { MyFarmView() }.tabItem { Label("என் பண்ணை", systemImage: "leaf") }.tag(3)
                }
            }
        }
        .tint(.green)
        .alert("தகவல்", isPresented: Binding(get: { store.error != nil }, set: { if !$0 { store.error = nil } })) {
            Button("சரி") { store.error = nil }
        } message: { Text(store.error ?? "") }
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
                    Text("உங்கள் பண்ணையின் பாதுகாப்பான இணைப்பு").font(.headline)
                    Text("முதல் முறையில் மட்டும் இந்த இணைப்பை அமைக்க வேண்டும். உங்கள் உதவியாளரின் உதவியையும் பெறலாம்.")
                }
                Section("இணைப்பு அமைப்பு · Local demo") {
                    TextField("சேவை முகவரி", text: $url).keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("serverURL")
                    SecureField("பண்ணைக்கான இணைப்புக் குறியீடு", text: $token).textInputAutocapitalization(.never).autocorrectionDisabled().accessibilityIdentifier("sessionToken")
                    Text("இது பண்ணைக்கான தனிப்பட்ட குறியீடு. Claude அல்லது speech API key இங்கு தேவையில்லை.").font(.caption).foregroundStyle(.secondary)
                    Button("இணைக்கவும்") {
                        do { try store.configure(url: url, token: token) }
                        catch { store.error = "முகவரியைச் சரிபார்க்கவும். HTTPS அல்லது இந்த Mac-இன் localhost இணைப்பைப் பயன்படுத்தவும்." }
                    }.disabled(token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("connect")
                }
            }.navigationTitle("பண்ணை உதவி")
        }.onAppear { url = store.baseURL }
    }
}
