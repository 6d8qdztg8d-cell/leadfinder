import Foundation

class ServerManager: ObservableObject {
    @Published var isReady = false
    @Published var errorMessage: String?

    private var process: Process?

    init() {
        DispatchQueue.global(qos: .userInitiated).async { self.start() }
    }

    private func start() {
        guard let nodeURL = Bundle.main.url(forResource: "node", withExtension: nil) else {
            fail("node-Binary nicht im App-Bundle gefunden.")
            return
        }
        guard let appDir = Bundle.main.resourceURL?.appendingPathComponent("app"),
              FileManager.default.fileExists(atPath: appDir.appendingPathComponent("server.js").path) else {
            fail("server.js nicht im App-Bundle gefunden.")
            return
        }

        // Ensure node binary is executable
        try? FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: nodeURL.path)

        // App Support directories
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        let dataDir        = support.appendingPathComponent("LeadFinder/data")
        let screenshotsDir = support.appendingPathComponent("LeadFinder/screenshots")
        try? FileManager.default.createDirectory(at: dataDir,        withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: screenshotsDir, withIntermediateDirectories: true)

        let p = Process()
        p.executableURL      = nodeURL
        p.arguments          = [appDir.appendingPathComponent("server.js").path]
        p.currentDirectoryURL = appDir
        p.environment = ProcessInfo.processInfo.environment.merging([
            "DATA_DIR":        dataDir.path,
            "SCREENSHOTS_DIR": screenshotsDir.path,
            "PUBLIC_DIR":      appDir.appendingPathComponent("public").path,
            "PORT":            "3737",
            "HOME":            NSHomeDirectory()
        ]) { _, new in new }

        do {
            try p.run()
            process = p
            pollServer()
        } catch {
            fail("Server konnte nicht gestartet werden: \(error.localizedDescription)")
        }
    }

    private func pollServer(attempts: Int = 40) {
        guard attempts > 0 else {
            fail("Server antwortet nicht auf Port 3737.")
            return
        }
        DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self else { return }
            var req = URLRequest(url: URL(string: "http://localhost:3737/api/stats")!)
            req.timeoutInterval = 1
            URLSession.shared.dataTask(with: req) { [weak self] _, response, _ in
                guard let self else { return }
                if (response as? HTTPURLResponse)?.statusCode == 200 {
                    DispatchQueue.main.async { self.isReady = true }
                } else {
                    self.pollServer(attempts: attempts - 1)
                }
            }.resume()
        }
    }

    private func fail(_ msg: String) {
        DispatchQueue.main.async { self.errorMessage = msg }
    }

    deinit { process?.terminate() }
}
