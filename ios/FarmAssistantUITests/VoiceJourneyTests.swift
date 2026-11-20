import XCTest

final class VoiceJourneyTests: XCTestCase {
    @MainActor
    func testVoiceReplyPlaysAndReplays() throws {
        let env = ProcessInfo.processInfo.environment
        let english = env["FARM_TEST_LOCALE"] == "en-IN"
        let language = english ? "English" : "தமிழ்"
        let tabs = english ? ["Today", "Conversation", "Calendar", "My Farm"] : ["இன்று", "உரையாடல்", "நாள்காட்டி", "என் பண்ணை"]
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
        guard reply.waitForExistence(timeout: 30) else {
            attachScreen("Farm connection unavailable")
            return XCTFail("Could not open the connected test farm")
        }
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
            let allow = XCUIApplication(bundleIdentifier: "com.apple.springboard").alerts.buttons["Allow"]
            if allow.waitForExistence(timeout: 3) { allow.tap() }
            let stop = app.buttons[english ? "Stop recording" : "பதிவை நிறுத்தவும்"]
            guard stop.waitForExistence(timeout: 8) else {
                attachScreen("Microphone did not start")
                return XCTFail("Could not start microphone recording")
            }
            _ = try XCTUnwrap(env["FARM_UI_TEST_MIC"], "Set only when the host microphone is supplied with the test phrase.")
            FileHandle.standardOutput.write(Data("KALANI_MIC_RECORDING\n".utf8))
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
        XCTAssertTrue(waitForValue(play, "idle", timeout: 90))
        let replay = app.buttons[identifier]
        replay.tap()
        XCTAssertTrue(waitForValue(replay, "playing", timeout: 8))
        attachScreen("Same Kalani \(language) reply replaying")
        XCTAssertTrue(waitForValue(replay, "idle", timeout: 90))

        for index in [1, 2, 3, 0] {
            let tab = tabs[index]
            let button = app.tabBars.buttons[tab]
            XCTAssertTrue(button.exists, tab)
            button.tap()
            let title = english && index == 3 ? "My farm" : tab
            XCTAssertTrue(app.navigationBars[title].waitForExistence(timeout: 8), title)
        }
    }

    @MainActor
    func testCalendarFromRequest() throws {
        let env = ProcessInfo.processInfo.environment
        let english = env["FARM_TEST_LOCALE"] == "en-IN"
        let language = english ? "English" : "தமிழ்"
        let today = english ? "Today" : "இன்று"
        let calendar = english ? "Calendar" : "நாள்காட்டி"
        let voice = env["FARM_UI_TEST_AUDIO"]
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FARM_SESSION_TOKEN": try XCTUnwrap(env["FARM_SESSION_TOKEN"]),
            "FARM_API_URL": try XCTUnwrap(env["FARM_API_URL"])
        ]
        if let voice { app.launchEnvironment["FARM_UI_TEST_AUDIO"] = voice }
        app.launch()
        let initial = app.buttons[english ? "chooseEnglish" : "chooseTamil"]
        if initial.waitForExistence(timeout: 3) { initial.tap() }
        let reply = app.buttons["reply"]
        XCTAssertTrue(reply.waitForExistence(timeout: 30))
        let switcher = app.segmentedControls["navigationLanguage"].buttons[language]
        XCTAssertTrue(switcher.exists)
        switcher.tap()
        XCTAssertTrue(app.navigationBars[today].waitForExistence(timeout: 10))
        reply.tap()
        if voice != nil {
            let consent = app.buttons[english ? "Allow audio processing" : "ஒலியை அனுப்ப அனுமதிக்கிறேன்"]
            if consent.waitForExistence(timeout: 3) { consent.tap() }
        } else {
            let field = app.descendants(matching: .any)["messageText"].firstMatch
            XCTAssertTrue(field.waitForExistence(timeout: 8))
            field.tap()
            field.typeText(try XCTUnwrap(env["FARM_UI_TEST_REQUEST"]))
        }
        let send = app.buttons["sendMessage"]
        if !send.isHittable { app.swipeUp() }
        send.tap()
        if voice != nil {
            let save = app.buttons["calendarSave"].firstMatch
            guard save.waitForExistence(timeout: 90) else {
                attachScreen("Calendar preview unavailable")
                return XCTFail("A spoken request must offer a calendar preview")
            }
            attachScreen("Kalani \(language) calendar preview")
            save.tap()
        }
        let open = app.buttons["openCalendarEvent"].firstMatch
        guard open.waitForExistence(timeout: 90) else {
            attachScreen("Saved calendar link unavailable")
            return XCTFail("No saved event linked from Kalani’s reply")
        }
        attachScreen("Kalani \(language) saved event")
        open.tap()
        XCTAssertTrue(app.navigationBars[calendar].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["calendarEventTitle"].firstMatch.waitForExistence(timeout: 10))
        attachScreen("Kalani \(language) calendar agenda")
        app.buttons["calendarUndo"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts[english ? "Nothing is scheduled for this day." : "இந்த நாளில் எதுவும் திட்டமிடப்படவில்லை."].waitForExistence(timeout: 10))
    }

    @MainActor
    func testSpokenLanguageSwitch() throws {
        let env = ProcessInfo.processInfo.environment
        let startsEnglish = env["FARM_TEST_LOCALE"] == "en-IN"
        let start = startsEnglish ? "English" : "தமிழ்"
        let startTitle = startsEnglish ? "Today" : "இன்று"
        let finishTitle = startsEnglish ? "இன்று" : "Today"
        let app = XCUIApplication()
        app.launchEnvironment = [
            "FARM_SESSION_TOKEN": try XCTUnwrap(env["FARM_SESSION_TOKEN"]),
            "FARM_API_URL": try XCTUnwrap(env["FARM_API_URL"]),
            "FARM_UI_TEST_AUDIO": try XCTUnwrap(env["FARM_UI_TEST_AUDIO"])
        ]
        app.launch()
        let initial = app.buttons[startsEnglish ? "chooseEnglish" : "chooseTamil"]
        if initial.waitForExistence(timeout: 3) { initial.tap() }
        let reply = app.buttons["reply"]
        XCTAssertTrue(reply.waitForExistence(timeout: 30))
        app.segmentedControls["navigationLanguage"].buttons[start].tap()
        XCTAssertTrue(app.navigationBars[startTitle].waitForExistence(timeout: 10))
        let audioButtons = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH %@", "assistant-audio-"))
        let previous = audioButtons.allElementsBoundByIndex.map(\.identifier)
        reply.tap()
        let consent = app.buttons[startsEnglish ? "Allow audio processing" : "ஒலியை அனுப்ப அனுமதிக்கிறேன்"]
        if consent.waitForExistence(timeout: 3) { consent.tap() }
        app.buttons["sendMessage"].tap()
        XCTAssertTrue(app.navigationBars[finishTitle].waitForExistence(timeout: 60))
        let play = audioButtons.matching(NSPredicate(format: "NOT (identifier IN %@)", previous)).firstMatch
        XCTAssertTrue(play.waitForExistence(timeout: 60))
        attachScreen("Kalani spoken language switch")
        play.tap()
        XCTAssertTrue(waitForValue(play, "playing", timeout: 8))
        XCTAssertTrue(waitForValue(play, "idle", timeout: 30))
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
