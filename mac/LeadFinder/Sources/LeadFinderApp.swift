import SwiftUI

@main
struct LeadFinderApp: App {
    @StateObject private var server = ServerManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(server)
                .frame(minWidth: 900, idealWidth: 1400, minHeight: 600, idealHeight: 900)
        }
        .windowStyle(.titleBar)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
    }
}
