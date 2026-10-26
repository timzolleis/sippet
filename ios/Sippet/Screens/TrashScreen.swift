import SippetCore
import SwiftUI

/// Trashed recipes, soonest purge first; swipe or the menu restores (revising 7, 8).
struct TrashScreen: View {
    let model: AppModel
    @ScaledMetric(relativeTo: .headline) private var tile: CGFloat = 52

    var body: some View {
        let trash = model.store.trash
        List(trash) { recipe in
            HStack(spacing: 14) {
                RecipeArtTile(id: recipe.id, size: min(tile, 72))
                    .saturation(0.2)
                    .opacity(0.75)
                VStack(alignment: .leading, spacing: 4) {
                    Text(recipe.title).font(.rounded(.headline))
                    if let purgeAt = recipe.purgeAt {
                        Label {
                            Text("will be deleted on \(purgeAt.formatted(.dateTime.day().month(.abbreviated)))")
                        } icon: {
                            Image(systemName: "hourglass")
                        }
                        .labelStyle(SmallIconLabelStyle())
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(.vertical, 6)
            .accessibilityElement(children: .combine)
            .accessibilityAction(named: "Restore") { restore(recipe) }
            .swipeActions(edge: .leading) {
                Button("Restore", systemImage: "arrow.uturn.backward") { restore(recipe) }
                    .tint(.accentColor)
                    .disabled(model.isOffline)
            }
            .contextMenu {
                Button("Restore", systemImage: "arrow.uturn.backward") { restore(recipe) }
                    .disabled(model.isOffline)
            }
        }
        .listStyle(.plain)
        .animation(.snappy, value: trash.map(\.id))
        .overlay {
            if trash.isEmpty {
                ContentUnavailableView(
                    "Trash is empty", systemImage: "trash",
                    description: Text("Recipes you delete stay here for 30 days."))
            }
        }
        .navigationTitle("Trash")
        .navigationSubtitle(trash.isEmpty ? Text(verbatim: "") : Text("Kept for 30 days, then deleted"))
    }

    private func restore(_ recipe: DeviceRecipe) {
        Task { await model.restore([recipe.id]) }
    }
}
