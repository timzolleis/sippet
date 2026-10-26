import SippetCore
import SwiftUI

/// All recipes · Collections · Smart collections · Tags · Trash · Settings. Each with its count; collections show
/// their recipes' art, smart collections their filter's symbol, tags are chips in their colour.
struct LibrarySidebar: View {
    let model: AppModel
    @Binding var selection: SidebarItem?
    @Binding var showSettings: Bool
    @SceneStorage("sidebar.collections") private var collectionsOpen = true
    @SceneStorage("sidebar.smart") private var smartOpen = true
    @SceneStorage("sidebar.tags") private var tagsOpen = true

    private var store: LibraryStore { model.store }

    var body: some View {
        let organization = store.organization
        List(selection: $selection) {
            SidebarRow(title: Text("All recipes"), count: store.library.count) { symbol("book") }
                .tag(SidebarItem.all)
            if !organization.collections.isEmpty {
                Section("Collections", isExpanded: $collectionsOpen) {
                    ForEach(organization.collections, id: \.name) { collection in
                        let ids = store.recipes(inCollection: collection.name).map(\.id)
                        SidebarRow(title: Text(verbatim: collection.name), count: ids.count) { CollectionThumb(recipeIds: ids) }
                            .tag(SidebarItem.collection(collection.name))
                            .organizeMenu(.collection, collection.name)
                    }
                }
            }
            if !organization.smartCollections.isEmpty {
                Section("Smart collections", isExpanded: $smartOpen) {
                    ForEach(organization.smartCollections, id: \.name) { smart in
                        SidebarRow(title: Text(verbatim: smart.name), count: store.recipes(matching: smart).count) {
                            SmartThumb(symbol: smartSymbol(smart.filter))
                        }
                        .tag(SidebarItem.smart(smart.name))
                    }
                }
            }
            if !organization.tags.isEmpty {
                Section("Tags", isExpanded: $tagsOpen) {
                    tagChips(organization.tags)
                }
            }
            Section {
                SidebarRow(title: Text("Trash"), count: store.trash.count) { symbol("trash") }
                    .tag(SidebarItem.trash)
                Button("Settings", systemImage: "gearshape") { showSettings = true }
                    .foregroundStyle(.primary)
            }
        }
        .navigationTitle("Sippet")
        .animation(.snappy, value: organization)
        .animation(.snappy, value: store.trash.count)
    }

    private func symbol(_ name: String) -> some View {
        Image(systemName: name).foregroundStyle(.tint)
    }

    /// One row of chips; each chip opens its tag and has the tag's menu.
    private func tagChips(_ tags: [TagView]) -> some View {
        Flow(spacing: 8, lineSpacing: 8) {
            ForEach(tags, id: \.name) { tag in
                let count = store.recipes(taggedWith: tag.name).count
                let selected = selection == .tag(tag.name)
                Button { selection = .tag(tag.name) } label: {
                    TagChip(name: tag.name, count: count, selected: selected)
                }
                .buttonStyle(PressableStyle())
                .organizeMenu(.tag, tag.name) { TagChip(name: tag.name, count: count).padding(8) }
                .accessibilityLabel(Text(verbatim: tag.name))
                .accessibilityValue(Text("\(count) recipes"))
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets(top: 4, leading: 4, bottom: 4, trailing: 4))
    }
}

/// Icon, name, count as a badge. At accessibility sizes the three stack, so the name keeps the row's width.
private struct SidebarRow<Icon: View>: View {
    let title: Text
    let count: Int
    @ViewBuilder let icon: Icon
    @Environment(\.dynamicTypeSize) private var typeSize

    var body: some View {
        if typeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 6) {
                icon
                title
                if count > 0 {
                    Text("\(count) recipes").font(.subheadline).foregroundStyle(.secondary)
                }
            }
            .padding(.vertical, 4)
            .accessibilityElement(children: .combine)
        } else {
            Label { title } icon: { icon }
                .badge(count)
        }
    }
}
