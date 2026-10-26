import SippetCore
import SwiftUI

struct SettingsScreen: View {
    let model: AppModel
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @AppStorage(MeasurementSystem.defaultsKey) private var units = MeasurementSystem.asWritten
    @AppStorage(DeviceName.defaultsKey) private var deviceName = ""
    @State private var confirmSignOut = false
    @AppStorage(Theme.hueKey) private var hue = Double(Theme.standard.hue)
    @AppStorage(Theme.rangeKey) private var range = Double(Theme.standard.range)
    @ScaledMetric(relativeTo: .caption) private var swatchWidth: CGFloat = 60

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
                colour
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

    // MARK: colour

    /// The theme: a swatch per preset, the art's range, and the first recipes as they'll look.
    private var colour: some View {
        Section {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: swatchWidth), spacing: 8)], spacing: 12) {
                ForEach(Theme.presets) { preset in
                    Swatch(preset: preset, range: Float(range), isSelected: Float(hue) == preset.hue) {
                        withAnimation(.snappy) { hue = Double(preset.hue) }
                    }
                }
            }
            .padding(.vertical, 4)
            .listRowInsets(EdgeInsets(top: 8, leading: 16, bottom: 8, trailing: 16))
            Picker("Recipe art", selection: Binding(
                get: { Theme.ArtRange(rawValue: Float(range)) ?? .all },
                set: { range = Double($0.rawValue) })
            ) {
                ForEach(Theme.ArtRange.allCases) { Text($0.title).tag($0) }
            }
            HStack(spacing: 10) {
                ForEach(previewIds, id: \.self) { id in
                    RecipeArtTile(id: id, size: 52, cornerRadius: 12)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityHidden(true)
        } header: {
            Text("Colour")
        } footer: {
            Text("Sets the accent and the colours of every recipe's art.")
        }
    }

    /// The first recipes, or stand-ins on an empty library.
    private var previewIds: [String] {
        let ids = model.store.library.prefix(5).map(\.id)
        return ids.count >= 5 ? Array(ids) : (0..<5).map { "preview-\($0)" }
    }
}

/// The preset's accent as a disc, a ring when selected, the name under it.
private struct Swatch: View {
    let preset: Theme.Preset
    let range: Float
    let isSelected: Bool
    let select: () -> Void

    var body: some View {
        let theme = Theme(hue: preset.hue, range: range)
        Button(action: select) {
            VStack(spacing: 6) {
                Circle()
                    .fill(theme.accent)
                    .frame(width: 36, height: 36)
                    .padding(4)
                    .overlay {
                        Circle().strokeBorder(isSelected ? theme.accent : .clear, lineWidth: 2)
                    }
                Text(preset.name)
                    .font(.caption)
                    .foregroundStyle(isSelected ? .primary : .secondary)
            }
            .frame(maxWidth: .infinity)
            .contentShape(.rect)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel(Text(preset.name))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}
