import SippetCore
import SwiftUI

enum SidebarItem: Hashable {
    case all, collection(String), smart(String), tag(String), trash
}

private struct Renaming: Identifiable {
    enum Kind { case tag, collection }
    let kind: Kind
    let name: String
    var id: String { "\(kind)-\(name)" }
}

struct LibraryScreen: View {
    let model: AppModel
    @State private var selection: SidebarItem? = .all
    @State private var recipeId: String?
    @State private var showSettings = false
    @State private var renaming: Renaming?
    @State private var newName = ""
    @State private var deleting: Renaming?
    @State private var columns: NavigationSplitViewVisibility = .automatic
    @State private var shownNotice: ChangeNotice?

    private var store: LibraryStore { model.store }

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            sidebar
        } content: {
            content
        } detail: {
            detail
        }
        .overlay(alignment: .top) { banners }
        .sheet(isPresented: $showSettings) { SettingsScreen(model: model) }
        .alert(renamePrompt, isPresented: Binding(get: { renaming != nil }, set: { if !$0 { renaming = nil } })) {
            TextField("Name", text: $newName)
            Button("Cancel", role: .cancel) {}
            Button("Rename") { rename() }
        }
        .confirmationDialog(
            "Delete?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } }),
            titleVisibility: .visible, presenting: deleting
        ) { item in
            Button("Delete “\(item.name)”", role: .destructive) { delete(item) }
        } message: { _ in
            Text("The recipes stay in your library.")
        }
        .onChange(of: model.sync?.lastNotice) { _, notice in
            guard let notice else { return }
            shownNotice = notice
        }
        .task(id: shownNotice) {
            guard shownNotice != nil else { return }
            try? await Task.sleep(for: .seconds(4))
            if !Task.isCancelled { shownNotice = nil }
        }
    }

    // MARK: sidebar

    private var sidebar: some View {
        let organization = store.organization
        return List(selection: $selection) {
            Label("All recipes", systemImage: "book").tag(SidebarItem.all)
            if !organization.collections.isEmpty {
                Section("Collections") {
                    ForEach(organization.collections, id: \.name) { collection in
                        Label(collection.name, systemImage: "folder").tag(SidebarItem.collection(collection.name))
                            .contextMenu {
                                Button("Rename…", systemImage: "pencil") { startRename(.collection, collection.name) }
                                Button("Delete", systemImage: "trash", role: .destructive) { deleting = Renaming(kind: .collection, name: collection.name) }
                            }
                    }
                }
            }
            if !organization.smartCollections.isEmpty {
                Section("Smart collections") {
                    ForEach(organization.smartCollections, id: \.name) { smart in
                        Label(smart.name, systemImage: "gearshape.2").tag(SidebarItem.smart(smart.name))
                    }
                }
            }
            if !organization.tags.isEmpty {
                Section("Tags") {
                    ForEach(organization.tags, id: \.name) { tag in
                        Label(tag.name, systemImage: "tag").tag(SidebarItem.tag(tag.name))
                            .contextMenu {
                                Button("Rename…", systemImage: "pencil") { startRename(.tag, tag.name) }
                                Button("Delete", systemImage: "trash", role: .destructive) { deleting = Renaming(kind: .tag, name: tag.name) }
                            }
                    }
                }
            }
            Section {
                Label("Trash", systemImage: "trash").tag(SidebarItem.trash)
                    .badge(store.trash.count)
                Button("Settings", systemImage: "gearshape") { showSettings = true }
                    .foregroundStyle(.primary)
            }
        }
        .navigationTitle("Sippet")
    }

    private var renamePrompt: LocalizedStringKey {
        renaming?.kind == .collection ? "Rename collection" : "Rename tag"
    }

    private func startRename(_ kind: Renaming.Kind, _ name: String) {
        guard !model.isOffline else { model.alertMessage = String(localized: "Offline"); return }
        newName = name
        renaming = Renaming(kind: kind, name: name)
    }

    private func rename() {
        guard let item = renaming, !newName.isEmpty, newName != item.name else { return }
        let edit: LibraryEdit = item.kind == .tag
            ? .renameTag(tag: item.name, to: newName)
            : .renameCollection(collection: item.name, to: newName)
        Task {
            if await model.edit([edit]), selection == (item.kind == .tag ? .tag(item.name) : .collection(item.name)) {
                selection = item.kind == .tag ? .tag(newName) : .collection(newName)
            }
        }
    }

    private func delete(_ item: Renaming) {
        guard !model.isOffline else { model.alertMessage = String(localized: "Offline"); return }
        let edit: LibraryEdit = item.kind == .tag ? .deleteTag(tag: item.name) : .deleteCollection(collection: item.name)
        Task {
            if await model.edit([edit]) { selection = .all }
        }
    }

    // MARK: content and detail

    @ViewBuilder private var content: some View {
        switch selection ?? .all {
        case .all:
            RecipeList(model: model, title: "All recipes", recipes: store.library, collection: nil, selection: $recipeId)
        case .collection(let name):
            RecipeList(model: model, title: LocalizedStringKey(name), recipes: store.recipes(inCollection: name), collection: name, selection: $recipeId)
        case .smart(let name):
            if let smart = store.organization.smartCollections.first(where: { $0.name == name }) {
                RecipeList(model: model, title: LocalizedStringKey(name), recipes: store.recipes(matching: smart), collection: nil, selection: $recipeId)
            }
        case .tag(let name):
            RecipeList(model: model, title: LocalizedStringKey(name), recipes: store.recipes(taggedWith: name), collection: nil, selection: $recipeId)
        case .trash:
            TrashScreen(model: model)
        }
    }

    @ViewBuilder private var detail: some View {
        if let recipeId, let recipe = store.recipes[recipeId], recipe.trashedAt == nil {
            NavigationStack { RecipeScreen(recipe: recipe).id(recipe.id) }
        } else {
            ContentUnavailableView("No recipe selected", systemImage: "fork.knife")
        }
    }

    // MARK: banner and offline pill

    private var banners: some View {
        VStack(spacing: 8) {
            if let notice = shownNotice {
                Button {
                    recipeId = notice.recipeIds.count == 1 ? notice.recipeIds.first : recipeId
                    shownNotice = nil
                } label: {
                    Label(notice.text, systemImage: "sparkles")
                        .font(.callout.weight(.medium))
                        .padding(.horizontal, 16).padding(.vertical, 10)
                        .glassEffect(.regular, in: .capsule)
                }
                .buttonStyle(.plain)
                .transition(.move(edge: .top).combined(with: .opacity))
            }
            if model.isOffline {
                Label("Offline", systemImage: "wifi.slash")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 10).padding(.vertical, 5)
                    .glassEffect(.regular, in: .capsule)
                    .transition(.opacity)
            }
        }
        .padding(.top, 4)
        .animation(.snappy, value: shownNotice)
        .animation(.snappy, value: model.isOffline)
        .accessibilityElement(children: .contain)
    }
}

// MARK: list

struct RecipeList: View {
    let model: AppModel
    let title: LocalizedStringKey
    let recipes: [DeviceRecipe]
    let collection: String?
    @Binding var selection: String?
    @State private var search = ""
    @State private var tagsFor: DeviceRecipe?
    @State private var collectionsFor: DeviceRecipe?

    private var canReorder: Bool { collection != nil && search.isEmpty && !model.isOffline }

    private var shown: [DeviceRecipe] {
        search.trimmingCharacters(in: .whitespaces).isEmpty ? recipes : model.store.search(search, in: recipes)
    }

    var body: some View {
        List(selection: $selection) {
            ForEach(shown) { recipe in
                row(recipe)
                    .tag(recipe.id)
                    .swipeActions(edge: .trailing) {
                        Button("To the trash", systemImage: "trash", role: .destructive) {
                            Task { await model.trash([recipe.id]) }
                        }
                        .disabled(model.isOffline)
                    }
                    .contextMenu {
                        Button("Tags…", systemImage: "tag") { tagsFor = recipe }
                            .disabled(model.isOffline)
                        Button("To collection…", systemImage: "folder.badge.plus") { collectionsFor = recipe }
                            .disabled(model.isOffline)
                    }
            }
            .onMove(perform: canReorder ? { move(from: $0, to: $1) } : nil)
        }
        .overlay {
            if shown.isEmpty {
                if search.isEmpty {
                    ContentUnavailableView("No recipes", systemImage: "book.closed")
                } else {
                    ContentUnavailableView.search(text: search)
                }
            }
        }
        .navigationTitle(title)
        .searchable(text: $search, prompt: "Search")
        .toolbar {
            if collection != nil, !model.isOffline { EditButton() }
        }
        .sheet(item: $tagsFor) { recipe in TagsSheet(model: model, recipe: recipe) }
        .sheet(item: $collectionsFor) { recipe in CollectionSheet(model: model, recipe: recipe) }
    }

    private static func detail(_ recipe: DeviceRecipe, tags: [String]) -> String {
        var parts: [String] = []
        if let minutes = recipe.totalMinutes { parts.append(Format.minutes(minutes)) }
        parts.append(contentsOf: tags)
        return parts.joined(separator: " · ")
    }

    private func row(_ recipe: DeviceRecipe) -> some View {
        let tags = model.store.tags(of: recipe.id)
        return VStack(alignment: .leading, spacing: 2) {
            Text(recipe.title).font(.headline)
            let detail = Self.detail(recipe, tags: tags)
            if !detail.isEmpty {
                Text(detail).font(.subheadline).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// reorder_collection with the full order (library rule 11).
    private func move(from offsets: IndexSet, to destination: Int) {
        guard let collection else { return }
        var ids = shown.map(\.id)
        ids.move(fromOffsets: offsets, toOffset: destination)
        let rest = (model.store.organization.collections.first { $0.name == collection }?.recipeIds ?? []).filter { !ids.contains($0) }
        Task { await model.edit([.reorderCollection(collection: collection, recipeIds: ids + rest)]) }
    }
}
