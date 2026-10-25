import SippetCore
import SwiftUI

struct TrashScreen: View {
    let model: AppModel

    var body: some View {
        let trash = model.store.trash
        List(trash) { recipe in
            VStack(alignment: .leading, spacing: 2) {
                Text(recipe.title).font(.headline)
                if let purgeAt = recipe.purgeAt {
                    Text("will be deleted on \(purgeAt.formatted(.dateTime.day().month(.abbreviated)))")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .accessibilityElement(children: .combine)
            .swipeActions(edge: .leading) {
                Button("Restore", systemImage: "arrow.uturn.backward") {
                    Task { await model.restore([recipe.id]) }
                }
                .tint(.accentColor)
                .disabled(model.isOffline)
            }
            .contextMenu {
                Button("Restore", systemImage: "arrow.uturn.backward") {
                    Task { await model.restore([recipe.id]) }
                }
                .disabled(model.isOffline)
            }
        }
        .overlay {
            if trash.isEmpty { ContentUnavailableView("Trash is empty", systemImage: "trash") }
        }
        .navigationTitle("Trash")
    }
}
