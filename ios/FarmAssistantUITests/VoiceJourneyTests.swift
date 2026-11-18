import XCTest

final class VoiceJourneyTests: XCTestCase {
    @MainActor
    func testVoiceReplyPlaysAndReplays() throws {
        let env = ProcessInfo.processInfo.environment
        let english = env["FARM_TEST_LOCALE"] == "en-IN"
        let language = english ? "English" : "தமிழ்"
        let tabs = english ? ["Today", "Conversation", "This Week", "My Farm"] : ["இன்று", "உரையாடல்", "இந்த வாரம்", "என் பண்ணை"]
        let otherFarmTitle = english ? "என் பண்ணை" : "My Farm"
        let token = try XCTUnwrap(env["FARM_SESSION_TOKEN"], "Run against a disposable farm session.")
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FARM_SESSION_TOKEN": token,
            "FARM_API_URL": try XCTUnwrap(env["FARM_API_URL"])
        ]
        if let fixture = env["FARM_UI_TEST_AUDIO"] {
            app.launchEnvironment["FARM_UI_TEST_AUDIO"] = fixture
        }
        app.launch()
        let initialChoice = app.buttons[english ? "chooseEnglish" : "chooseTamil"]
        if initialChoice.waitForExistence(timeout: 3) { initialChoice.tap() }
        let otherFarm = app.tabBars.buttons[otherFarmTitle]
        if otherFarm.waitForExistence(timeout: 3) {
            otherFarm.tap()
            let picker = app.segmentedControls["languagePreference"]
            XCTAssertTrue(picker.waitForExistence(timeout: 10))
            picker.buttons[language].tap()
            let today = app.tabBars.buttons[tabs[0]]
            XCTAssertTrue(today.waitForExistence(timeout: 10))
            today.tap()
        }
        let reply = app.buttons["reply"]
        XCTAssertTrue(reply.waitForExistence(timeout: 30))
        let audioButtons = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "assistant-audio-"))
        let previousReplyIDs = audioButtons.allElementsBoundByIndex.map(\.identifier)
        reply.tap()
        let consent = app.buttons[english ? "Allow audio processing" : "ஒலியை அனுப்ப அனுமதிக்கிறேன்"]
        if consent.waitForExistence(timeout: 3) { consent.tap() }
        let preview = app.buttons[english ? "Listen to my recording" : "என் பதிவைக் கேட்கவும்"]
        if env["FARM_UI_TEST_AUDIO"] == nil {
            let record = app.buttons[english ? "Record a message" : "பேசிப் பதிவு செய்யவும்"]
            XCTAssertTrue(record.waitForExistence(timeout: 10))
            record.tap()
            let allow = app.alerts.buttons["Allow"]
            if allow.waitForExistence(timeout: 3) { allow.tap() }
            let stop = app.buttons[english ? "Stop recording" : "பதிவை நிறுத்தவும்"]
            XCTAssertTrue(stop.waitForExistence(timeout: 8))
            _ = try XCTUnwrap(env["FARM_UI_TEST_MIC"], "Set only when the host microphone is supplied with the Tamil phrase.")
            print("KALANI_MIC_RECORDING")
            RunLoop.current.run(until: Date().addingTimeInterval(8))
            stop.tap()
        }
        XCTAssertTrue(preview.waitForExistence(timeout: 8))
        preview.tap()
        app.buttons["sendMessage"].tap()
        let play = audioButtons.matching(NSPredicate(format: "NOT (identifier IN %@)", previousReplyIDs)).firstMatch
        guard play.waitForExistence(timeout: 120) else {
            attachScreen("Reply missing")
            return XCTFail("No playable assistant reply in Today")
        }
        let identifier = play.identifier
        attachScreen("Kalani \(language) weather reply")
        play.tap()
        XCTAssertTrue(waitForValue(play, "playing", timeout: 8))
        XCTAssertTrue(waitForValue(play, "idle", timeout: 45))
        let replay = app.buttons[identifier]
        replay.tap()
        XCTAssertTrue(waitForValue(replay, "playing", timeout: 8))
        attachScreen("Same Kalani \(language) reply replaying")
        XCTAssertTrue(waitForValue(replay, "idle", timeout: 45))

        for index in [1, 2, 3, 0] {
            let tab = tabs[index]
            let button = app.tabBars.buttons[tab]
            XCTAssertTrue(button.exists, tab)
            button.tap()
            let title = english && index >= 2 ? (index == 2 ? "This week" : "My farm") : tab
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 8), title)
        }
    }

    private func waitForValue(_ element: XCUIElement, _ value: String, timeout: TimeInterval) -> Bool {
        let condition = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == %@", value), object: element)
        return XCTWaiter.wait(for: [condition], timeout: timeout) == .completed
    }

    @MainActor
    private func attachScreen(_ name: String) {
        let screenshot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        screenshot.name = name
        screenshot.lifetime = .keepAlways
        add(screenshot)
    }
}
