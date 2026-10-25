import SippetCore
import SwiftUI

/// Toggles per collection plus a new collection (library 7–10).
struct CollectionSheet: View {
    let model: AppModel
    let recipe: DeviceRecipe
    @Environment(\.dismiss) private var dismiss
    @State private var original: Set<String> = []
    @State private var selected: Set<String> = []
    @State private var newName = ""
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(model.store.organization.collections, id: \.name) { collection in
                        Toggle(collection.name, isOn: Binding(
                            get: { selected.contains(collection.name) },
                            set: { on in if on { selected.insert(collection.name) } else { selected.remove(collection.name) } }))
                    }
                }
                Section("New collection") {
                    TextField("Name", text: $newName)
                }
            }
            .navigationTitle(recipe.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(model.isOffline || (selected == original && trimmedName.isEmpty))
                }
            }
            .task {
                guard !loaded else { return }
                loaded = true
                original = Set(model.store.organization.collections.filter { $0.recipeIds.contains(recipe.id) }.map(\.name))
                selected = original
            }
        }
        .presentationDetents([.medium, .large])
    }

    private var trimmedName: String { newName.trimmingCharacters(in: .whitespaces) }

    private func save() {
        var edits = selected.subtracting(original).sorted().map { LibraryEdit.addToCollection(collection: $0, recipeIds: [recipe.id]) }
            + original.subtracting(selected).sorted().map { LibraryEdit.removeFromCollection(collection: $0, recipeIds: [recipe.id]) }
        if !trimmedName.isEmpty { edits.append(.createCollection(name: trimmedName, recipeIds: [recipe.id])) }
        dismiss()
        Task { await model.edit(edits) }
    }
}
