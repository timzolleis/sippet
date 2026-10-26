import SippetCore
import SwiftUI

struct TrashScreen: View {
    let model: AppModel
    @ScaledMetric(relativeTo: .headline) private var tile: CGFloat = 48

    var body: some View {
        let trash = model.store.trash
        List(trash) { recipe in
            HStack(spacing: 14) {
                RecipeArtTile(id: recipe.id, size: min(tile, 64))
                    .saturation(0.3)
                    .opacity(0.8)
                VStack(alignment: .leading, spacing: 2) {
                    Text(recipe.title).font(.rounded(.headline))
                    if let purgeAt = recipe.purgeAt {
                        Text("will be deleted on \(purgeAt.formatted(.dateTime.day().month(.abbreviated)))")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.vertical, 4)
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
