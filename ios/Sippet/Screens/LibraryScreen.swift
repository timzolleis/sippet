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
        #if DEBUG
        .task { debugSelect() }
        #endif
    }

    #if DEBUG
    /// `-SippetSelect sidebar|trash|collection:<name>|smart:<name>|tag:<name>`, `-SippetSettings`. Screenshots only.
    private func debugSelect() {
        let args = ProcessInfo.processInfo.arguments
        if args.contains("-SippetSettings") { showSettings = true }
        guard let at = args.firstIndex(of: "-SippetSelect"), at + 1 < args.count else { return }
        let value = args[at + 1]
        let name = value.split(separator: ":", maxSplits: 1).dropFirst().first.map(String.init) ?? ""
        switch value.split(separator: ":").first {
        case "sidebar": selection = nil
        case "trash": selection = .trash
        case "collection": selection = .collection(name)
        case "smart": selection = .smart(name)
        case "tag": selection = .tag(name)
        default: break
        }
    }
    #endif

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
            RecipeList(
                model: model, title: "All recipes", recipes: store.library, collection: nil, selection: $recipeId,
                folders: folders, openFolder: { selection = $0 })
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

    /// Collections, then smart collections, each with its first recipes and its count.
    private var folders: [Folder] {
        store.organization.collections.map { collection in
            let recipes = store.recipes(inCollection: collection.name)
            return Folder(item: .collection(collection.name), name: collection.name, recipeIds: recipes.map(\.id), isSmart: false)
        } + store.organization.smartCollections.map { smart in
            Folder(item: .smart(smart.name), name: smart.name, recipeIds: store.recipes(matching: smart).map(\.id), isSmart: true)
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

    /// Built here so it follows the device language (the core's text is German only).
    private func noticeText(_ notice: ChangeNotice) -> String {
        if notice.recipeIds.count == 1, let title = store.recipes[notice.recipeIds[0]]?.title {
            return String(localized: "\(notice.author) changed \(title)")
        }
        if notice.recipeIds.count > 1 {
            return String(localized: "\(notice.author) changed \(notice.recipeIds.count) recipes")
        }
        return notice.text
    }

    private var banners: some View {
        VStack(spacing: 8) {
            if let notice = shownNotice {
                Button {
                    recipeId = notice.recipeIds.count == 1 ? notice.recipeIds.first : recipeId
                    shownNotice = nil
                } label: {
                    Label(noticeText(notice), systemImage: "sparkles")
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
    /// All recipes: the collections as folder tiles above the recipes.
    var folders: [Folder] = []
    var openFolder: (SidebarItem) -> Void = { _ in }
    @State private var search = ""
    @State private var tagsFor: DeviceRecipe?
    @State private var collectionsFor: DeviceRecipe?

    private var canReorder: Bool { collection != nil && search.isEmpty && !model.isOffline }

    /// The dragged order, kept on screen until a catch-up brings the server's order.
    @State private var pendingOrder: [String]?

    private var serverOrder: [String] {
        model.store.organization.collections.first { $0.name == collection }?.recipeIds ?? []
    }

    private var shown: [DeviceRecipe] {
        guard search.trimmingCharacters(in: .whitespaces).isEmpty else { return model.store.search(search, in: recipes) }
        guard let pendingOrder else { return recipes }
        let byId = Dictionary(uniqueKeysWithValues: recipes.map { ($0.id, $0) })
        return pendingOrder.compactMap { byId[$0] } + recipes.filter { !pendingOrder.contains($0.id) }
    }

    var body: some View {
        ScrollViewReader { proxy in
            list
            #if DEBUG
            .task {
                guard DebugScroll.anchor != nil, let last = shown.last else { return }
                try? await Task.sleep(for: .milliseconds(600))
                proxy.scrollTo(last.id, anchor: .bottom)
            }
            #endif
        }
    }

    private var showsFolders: Bool { !folders.isEmpty && search.isEmpty }

    private var list: some View {
        List(selection: $selection) {
            if showsFolders {
                Section {
                    FolderGrid(folders: folders, open: openFolder)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 12, trailing: 16))
                        .listRowSeparator(.hidden)
                } header: {
                    Text("Collections")
                }
            }
            Section {
                recipeRows
            } header: {
                if showsFolders { Text("Recipes") }
            }
        }
        .listStyle(.plain)
        .overlay {
            if shown.isEmpty {
                if search.isEmpty {
                    ContentUnavailableView("No recipes", systemImage: "book.closed")
                } else {
                    ContentUnavailableView.search(text: search)
                }
            }
        }
        .onChange(of: serverOrder) { pendingOrder = nil }
        .onChange(of: collection) { pendingOrder = nil }
        .navigationTitle(title)
        .searchable(text: $search, prompt: "Search")
        .toolbar {
            if collection != nil, !model.isOffline { EditButton() }
        }
        .sheet(item: $tagsFor) { recipe in TagsSheet(model: model, recipe: recipe) }
        .sheet(item: $collectionsFor) { recipe in CollectionSheet(model: model, recipe: recipe) }
        #if DEBUG
        .task {
            // `-SippetSheet tags|collections` opens the sheet for the first recipe. Screenshots only.
            let args = ProcessInfo.processInfo.arguments
            guard let at = args.firstIndex(of: "-SippetSheet"), at + 1 < args.count, let first = shown.first else { return }
            if args[at + 1] == "tags" { tagsFor = first } else { collectionsFor = first }
        }
        #endif
    }

    private var recipeRows: some View {
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

    /// The recipe's art tile, the title, then time and tags with their symbols.
    /// At accessibility sizes the tile sits above the text and time and tags stack, so words don't break.
    private func row(_ recipe: DeviceRecipe) -> some View {
        RecipeRow(recipe: recipe, tags: model.store.tags(of: recipe.id))
    }
}

private struct RecipeRow: View {
    let recipe: DeviceRecipe
    let tags: [String]
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .headline) private var tile: CGFloat = 48

    var body: some View {
        let large = typeSize.isAccessibilitySize
        let layout = large
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 14))
        layout {
            RecipeArtTile(id: recipe.id, size: min(tile, 64))
            VStack(alignment: .leading, spacing: 3) {
                Text(recipe.title)
                    .font(.rounded(.headline))
                if recipe.totalMinutes != nil || !tags.isEmpty {
                    let meta = large
                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 2))
                        : AnyLayout(HStackLayout(spacing: 12))
                    meta {
                        if let minutes = recipe.totalMinutes {
                            Label(Format.minutes(minutes), systemImage: "clock")
                                .fixedSize()
                        }
                        if !tags.isEmpty {
                            Label(tags.joined(separator: ", "), systemImage: "tag")
                                .lineLimit(large ? 3 : 1)
                        }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .labelStyle(SmallIconLabelStyle())
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

private struct SmallIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            configuration.icon.imageScale(.small).foregroundStyle(.tertiary)
            configuration.title
        }
    }
}

extension RecipeList {

    /// reorder_collection with the full order (library rule 11).
    private func move(from offsets: IndexSet, to destination: Int) {
        guard let collection else { return }
        var ids = shown.map(\.id)
        ids.move(fromOffsets: offsets, toOffset: destination)
        let rest = serverOrder.filter { !ids.contains($0) }
        pendingOrder = ids
        Task {
            if await !model.edit([.reorderCollection(collection: collection, recipeIds: ids + rest)]) { pendingOrder = nil }
        }
    }
}
