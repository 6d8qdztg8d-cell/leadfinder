import SwiftUI
import WebKit

struct ContentView: View {
    @EnvironmentObject var server: ServerManager

    var body: some View {
        Group {
            if let err = server.errorMessage {
                ErrorView(message: err)
            } else if server.isReady {
                WebView(url: URL(string: "http://localhost:3737")!)
            } else {
                SplashView()
            }
        }
        .ignoresSafeArea()
    }
}

// MARK: - WebView

struct WebView: NSViewRepresentable {
    let url: URL

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.defaultWebpagePreferences.allowsContentJavaScript = true
        let wv = WKWebView(frame: .zero, configuration: config)
        wv.load(URLRequest(url: url))
        return wv
    }

    func updateNSView(_ nsView: WKWebView, context: Context) {}
}

// MARK: - Splash

struct SplashView: View {
    private let accent = Color(red: 0.788, green: 0.945, blue: 0.208)
    private let bg     = Color(red: 0.039, green: 0.039, blue: 0.039)

    var body: some View {
        ZStack {
            bg.ignoresSafeArea()
            VStack(spacing: 18) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(accent)
                        .frame(width: 54, height: 54)
                    Text("LF")
                        .font(.system(size: 17, weight: .black))
                        .foregroundColor(.black)
                }
                Text("LeadFinder startet…")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(accent)
                ProgressView()
                    .progressViewStyle(.circular)
                    .tint(accent)
                    .scaleEffect(0.75)
            }
        }
    }
}

// MARK: - Error

struct ErrorView: View {
    let message: String
    private let accent = Color(red: 0.788, green: 0.945, blue: 0.208)
    private let bg     = Color(red: 0.039, green: 0.039, blue: 0.039)
    private let red    = Color(red: 0.941, green: 0.239, blue: 0.239)

    var body: some View {
        ZStack {
            bg.ignoresSafeArea()
            VStack(alignment: .leading, spacing: 16) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(accent)
                            .frame(width: 40, height: 40)
                        Text("LF")
                            .font(.system(size: 13, weight: .black))
                            .foregroundColor(.black)
                    }
                    Text("LeadFinder")
                        .font(.system(size: 18, weight: .bold))
                        .foregroundColor(accent)
                }
                Text("⚠ Fehler beim Starten")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundColor(red)
                Text(message)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(Color(red: 0.78, green: 0.78, blue: 0.78))
                    .padding(14)
                    .background(Color(red: 0.08, green: 0.08, blue: 0.08))
                    .cornerRadius(8)
            }
            .padding(32)
            .frame(maxWidth: 700)
        }
    }
}
