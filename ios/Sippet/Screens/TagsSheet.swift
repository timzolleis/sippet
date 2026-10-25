import SippetCore
import SwiftUI

/// Toggles per tag plus new tags; Save sends one batch of tag/untag edits (library 1, 3–5).
struct TagsSheet: View {
    let model: AppModel
    let recipe: DeviceRecipe
    @Environment(\.dismiss) private var dismiss
    @State private var original: Set<String> = []
    @State private var selected: Set<String> = []
    @State private var added: [String] = []
    @State private var newTag = ""
    @State private var loaded = false

    private var names: [String] {
        let known = model.store.organization.tags.map(\.name)
        return known + added.filter { !known.contains($0) }
    }

    var body: some View {
        NavigationStack {
            List {
                Section {
                    ForEach(names, id: \.self) { name in
                        Toggle(name, isOn: Binding(
                            get: { selected.contains(name) },
                            set: { on in if on { selected.insert(name) } else { selected.remove(name) } }))
                    }
                }
                Section("New tag") {
                    HStack {
                        TextField("Name", text: $newTag).onSubmit(addTag)
                        Button("Add", action: addTag).disabled(newTag.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                }
            }
            .navigationTitle(recipe.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { save() }.disabled(model.isOffline || selected == original)
                }
            }
            .task {
                guard !loaded else { return }
                loaded = true
                original = Set(model.store.tags(of: recipe.id))
                selected = original
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func addTag() {
        let name = newTag.trimmingCharacters(in: .whitespaces)
        guard !name.isEmpty else { return }
        if !names.contains(name) { added.append(name) }
        selected.insert(name)
        newTag = ""
    }

    private func save() {
        let edits = selected.subtracting(original).sorted().map { LibraryEdit.tag(tag: $0, recipeIds: [recipe.id]) }
            + original.subtracting(selected).sorted().map { LibraryEdit.untag(tag: $0, recipeIds: [recipe.id]) }
        dismiss()
        Task { await model.edit(edits) }
    }
}
