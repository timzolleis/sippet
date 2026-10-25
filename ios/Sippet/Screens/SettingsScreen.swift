import SippetCore
import SwiftUI

struct SettingsScreen: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @AppStorage(MeasurementSystem.defaultsKey) private var units = MeasurementSystem.asWritten
    @AppStorage(DeviceName.defaultsKey) private var deviceName = ""
    @State private var confirmSignOut = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Picker("Units", selection: $units) {
                        ForEach(MeasurementSystem.allCases, id: \.self) { Text($0.title).tag($0) }
                    }
                } footer: {
                    Text("The starting point for every recipe. You can change it per recipe.")
                }
                Section {
                    TextField("Device name", text: $deviceName, prompt: Text(DeviceName.defaultName))
                } footer: {
                    Text("Shown in the change history, so you can tell your devices apart.")
                }
                Section {
                    Button("Manage account", systemImage: "person.crop.circle") {
                        openURL(AppConfig.serverURL.appending(path: "account"))
                    }
                    Button("Sign out", systemImage: "rectangle.portrait.and.arrow.right", role: .destructive) {
                        confirmSignOut = true
                    }
                }
            }
            .navigationTitle("Settings")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .confirmationDialog("Sign out of this device?", isPresented: $confirmSignOut, titleVisibility: .visible) {
                Button("Sign out", role: .destructive) {
                    dismiss()
                    Task { await model.signOut() }
                }
            } message: {
                Text("The library on this device is deleted. Your account and recipes stay.")
            }
        }
    }
}

