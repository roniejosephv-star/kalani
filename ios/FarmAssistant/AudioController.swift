import AVFoundation
import Observation

@MainActor @Observable final class AudioController: NSObject, AVAudioRecorderDelegate, AVAudioPlayerDelegate {
    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var recordingTimer: Task<Void, Never>?
    var isRecording = false
    var isPlaying = false
    var playingID: String?
    enum AudioError { case permission, record, play, interrupted }
    var error: AudioError?
    var startedAt: Date?
    func record(to url: URL) async -> Bool {
        guard await AVAudioApplication.requestRecordPermission() else {
            error = .permission
            return false
        }
        stopPlayback()
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker])
            try session.setActive(true)
            recorder = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1, AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue])
            recorder?.delegate = self
            guard recorder?.record() == true else { throw CocoaError(.fileWriteUnknown) }
            isRecording = true
            startedAt = Date()
            error = nil
            recordingTimer = Task { [weak self] in
                try? await Task.sleep(for: .seconds(29))
                guard !Task.isCancelled else { return }
                self?.stopRecording()
            }
            return true
        } catch { self.error = .record; return false }
    }
    func stopRecording() {
        recordingTimer?.cancel()
        recorder?.stop()
        recorder = nil
        isRecording = false
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    func play(data: Data, id: String) {
        if isPlaying && playingID == id { stopPlayback(); return }
        guard !isRecording else { return }
        do {
            try AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio)
            try AVAudioSession.sharedInstance().setActive(true)
            player = try AVAudioPlayer(data: data)
            player?.delegate = self
            guard player?.play() == true else { throw CocoaError(.fileReadCorruptFile) }
            playingID = id
            isPlaying = true
            error = nil
        } catch { self.error = .play }
    }
    func stopPlayback() {
        player?.stop()
        player = nil
        isPlaying = false
        playingID = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor [weak self] in self?.stopPlayback() }
    }
    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor [weak self] in
            self?.isRecording = false
            if !flag { self?.error = .interrupted }
        }
    }
}
