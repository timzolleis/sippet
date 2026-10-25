import SippetCore
import SwiftUI

@main
struct SippetApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            Root(model: model)
                .task { await model.launch() }
                .onChange(of: scenePhase) { _, phase in
                    Task { await model.sceneActive(phase == .active) }
                }
        }
    }
}

private struct Root: View {
    @Bindable var model: AppModel

    var body: some View {
        Group {
            switch model.phase {
            case .launching:
                ProgressView()
            case .signedOut:
                SignInScreen(model: model)
            case .signedIn:
                LibraryScreen(model: model)
            }
        }
        .onChange(of: model.sync?.isSignedOut) { model.checkSignedOut() }
        .alert("Something went wrong", isPresented: Binding(
            get: { model.alertMessage != nil },
            set: { if !$0 { model.alertMessage = nil } })
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(model.alertMessage ?? "")
        }
    }
}
