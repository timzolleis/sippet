import SippetCore
import SwiftUI

/// A tag the search narrows to; picked from the suggestions.
struct TagToken: Identifiable, Hashable {
    let name: String
    var id: String { name.lowercased() }
}

/// All recipes (with the collections as folders above), a collection, a smart collection, or a tag.
struct RecipeList: View {
    let model: AppModel
    let item: SidebarItem
    @State private var search = ""
    @State private var tokens: [TagToken] = []
    @State private var tagsFor: DeviceRecipe?
    @State private var collectionsFor: DeviceRecipe?
    /// The dragged order, kept on screen until a catch-up brings the server's order.
    @State private var pendingOrder: [String]?

    @Environment(\.open) private var open

    private var store: LibraryStore { model.store }

    private var collection: String? {
        if case .collection(let name) = item { name } else { nil }
    }

    private var smart: SmartCollectionView? {
        guard case .smart(let name) = item else { return nil }
        return store.organization.smartCollections.first { $0.name == name }
    }

    private var recipes: [DeviceRecipe] {
        switch item {
        case .all, .trash: store.library
        case .collection(let name): store.recipes(inCollection: name)
        case .smart: smart.map(store.recipes(matching:)) ?? []
        case .tag(let name): store.recipes(taggedWith: name)
        }
    }

    private var query: String { search.trimmingCharacters(in: .whitespaces) }
    private var isSearching: Bool { !query.isEmpty || !tokens.isEmpty }
    private var canReorder: Bool { collection != nil && !isSearching && !model.isOffline }

    private var serverOrder: [String] {
        store.organization.collections.first { $0.name == collection }?.recipeIds ?? []
    }

    private var shown: [DeviceRecipe] {
        var list = recipes
        if !query.isEmpty { list = store.search(query, in: list) }
        if !tokens.isEmpty {
            list = list.filter { recipe in
                let tags = Set(store.tags(of: recipe.id).map { $0.lowercased() })
                return tokens.allSatisfy { tags.contains($0.id) }
            }
        }
        guard !isSearching, let pendingOrder else { return list }
        let byId = Dictionary(uniqueKeysWithValues: list.map { ($0.id, $0) })
        return pendingOrder.compactMap { byId[$0] } + list.filter { !pendingOrder.contains($0.id) }
    }

    /// Tags not picked yet whose name holds the typed text; none before typing, so the results stay in view.
    private var suggestedTokens: [TagToken] {
        let picked = Set(tokens.map(\.id))
        return store.organization.tags.map { TagToken(name: $0.name) }.filter { token in
            !picked.contains(token.id) && item != .tag(token.name)
                && !query.isEmpty && token.name.localizedStandardContains(query)
        }
    }

    /// Collections, then smart collections, each with its first recipes and its count.
    private var folders: [Folder] {
        guard item == .all else { return [] }
        return store.organization.collections.map { collection in
            Folder(item: .collection(collection.name), name: collection.name,
                   recipeIds: store.recipes(inCollection: collection.name).map(\.id), smartSymbol: nil)
        } + store.organization.smartCollections.map { smart in
            Folder(item: .smart(smart.name), name: smart.name,
                   recipeIds: store.recipes(matching: smart).map(\.id), smartSymbol: smartSymbol(smart.filter))
        }
    }

    private var showsFolders: Bool { !folders.isEmpty && !isSearching && !recipes.isEmpty }

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

    private var list: some View {
        let shown = shown
        return List {
            if showsFolders {
                Section {
                    FolderGrid(folders: folders)
                        .listRowInsets(EdgeInsets(top: 4, leading: 16, bottom: 20, trailing: 16))
                        .listRowSeparator(.hidden)
                } header: {
                    Text("Collections")
                }
            }
            Section {
                recipeRows(shown)
            } header: {
                if showsFolders { Text("Recipes") }
            }
        }
        .listStyle(.plain)
        .headerProminence(.increased)
        // Moves, trashing, restoring and catch-ups slide rows in and out instead of redrawing the list.
        .animation(.snappy, value: shown.map(\.id))
        .overlay {
            if shown.isEmpty { empty }
        }
        .onChange(of: serverOrder) { pendingOrder = nil }
        .onChange(of: tokens) { search = "" }
        .navigationTitle(title)
        .navigationSubtitle(subtitle(count: shown.count))
        .searchable(text: $search, tokens: $tokens, prompt: Text("Title, ingredient or tag")) { token in
            Label(token.name, systemImage: "tag")
        }
        .searchSuggestions {
            // Tags as chips above the results; picking one turns it into a token.
            ForEach(suggestedTokens) { token in
                Label { Text(verbatim: token.name) } icon: {
                    Image(systemName: "tag.fill").foregroundStyle(TagColor(token.name).ink)
                }
                .searchCompletion(token)
            }
        }
        .toolbar {
            if collection != nil, !model.isOffline, !recipes.isEmpty { EditButton() }
        }
        .sheet(item: $tagsFor) { recipe in TagsSheet(model: model, recipe: recipe) }
        .sheet(item: $collectionsFor) { recipe in CollectionSheet(model: model, recipe: recipe) }
        #if DEBUG
        .task {
            // `-SippetSheet tags|collections` opens the sheet for the first recipe;
            // `-SippetSearch <text>` types into the search. Screenshots only.
            let args = ProcessInfo.processInfo.arguments
            if let at = args.firstIndex(of: "-SippetSearch"), at + 1 < args.count { search = args[at + 1] }
            guard let at = args.firstIndex(of: "-SippetSheet"), at + 1 < args.count, let first = shown.first else { return }
            if args[at + 1] == "tags" { tagsFor = first } else { collectionsFor = first }
        }
        #endif
    }

    private var title: Text {
        switch item {
        case .all, .trash: Text("All recipes")
        case .collection(let name), .smart(let name), .tag(let name): Text(verbatim: name)
        }
    }

    /// "9 recipes"; a smart collection adds its filter: "2 recipes · up to 30 min".
    private func subtitle(count: Int) -> Text {
        guard count > 0 || isSearching else { return Text(verbatim: "") }
        let recipes = String(localized: "\(count) recipes")
        guard let smart, !isSearching else { return Text(verbatim: recipes) }
        let filter = filterSummary(smart.filter)
        return Text(verbatim: filter.isEmpty ? recipes : "\(recipes) · \(filter)")
    }

    @ViewBuilder private var empty: some View {
        if isSearching {
            ContentUnavailableView.search(text: query.isEmpty ? tokens.map(\.name).joined(separator: ", ") : query)
        } else {
            switch item {
            case .all, .trash:
                ContentUnavailableView(
                    "No recipes yet", systemImage: "book.closed",
                    description: Text("Ask Claude to save a recipe; it shows up here."))
            case .collection(let name):
                ContentUnavailableView {
                    Label { Text("Nothing in \(name) yet") } icon: { Image(systemName: "folder") }
                } description: {
                    Text("Add recipes with To collection… in a recipe's menu.")
                }
            case .smart:
                ContentUnavailableView {
                    Label("No recipes match", systemImage: smart.map { smartSymbol($0.filter) } ?? "sparkles")
                } description: {
                    if let smart { Text(verbatim: filterSummary(smart.filter)) }
                }
            case .tag(let name):
                ContentUnavailableView {
                    Label { Text("No recipes tagged \(name)") } icon: { Image(systemName: "tag") }
                } description: {
                    Text("Tag recipes with Tags… in a recipe's menu.")
                }
            }
        }
    }

    private func recipeRows(_ shown: [DeviceRecipe]) -> some View {
        ForEach(shown) { recipe in
            let zoom = "\(item.key)/\(recipe.id)"
            Button { open(.recipe(recipe.id, zoom: zoom)) } label: {
                RecipeRow(recipe: recipe, tags: store.tags(of: recipe.id), zoom: zoom)
                    .foregroundStyle(.primary)
            }
            .swipeActions(edge: .trailing) {
                Button("To the trash", systemImage: "trash", role: .destructive) { trash(recipe) }
                    .disabled(model.isOffline)
            }
            .swipeActions(edge: .leading) {
                Button("Tags…", systemImage: "tag") { tagsFor = recipe }
                    .tint(.indigo)
                    .disabled(model.isOffline)
            }
            .contextMenu {
                Group {
                    Button("Tags…", systemImage: "tag") { tagsFor = recipe }
                    Button("To collection…", systemImage: "folder.badge.plus") { collectionsFor = recipe }
                    if let collection {
                        // library 10
                        Button("Remove from \(collection)", systemImage: "folder.badge.minus") {
                            Task { await model.edit([.removeFromCollection(collection: collection, recipeIds: [recipe.id])]) }
                        }
                    }
                    Divider()
                    Button("To the trash", systemImage: "trash", role: .destructive) { trash(recipe) }
                }
                .disabled(model.isOffline)
            }
        }
        .onMove(perform: canReorder ? { move(from: $0, to: $1) } : nil)
    }

    private func trash(_ recipe: DeviceRecipe) {
        guard !model.isOffline else { model.alertMessage = String(localized: "Offline"); return }
        Task { await model.trash([recipe.id]) }
    }

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

/// The recipe's art tile, the title, then time and tags.
/// At accessibility sizes the tile sits above the text and time and tags stack, so words don't break.
private struct RecipeRow: View {
    let recipe: DeviceRecipe
    let tags: [String]
    let zoom: String
    @Environment(\.dynamicTypeSize) private var typeSize
    @ScaledMetric(relativeTo: .headline) private var tile: CGFloat = 52

    var body: some View {
        let large = typeSize.isAccessibilitySize
        let layout = large
            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 10))
            : AnyLayout(HStackLayout(alignment: .center, spacing: 14))
        let side = min(tile, 72)
        layout {
            RecipeArtTile(id: recipe.id, size: side)
                .modifier(ZoomSource(id: zoom, cornerRadius: side * 0.26))
            VStack(alignment: .leading, spacing: 4) {
                Text(recipe.title)
                    .font(.rounded(.headline))
                    .lineLimit(large ? nil : 2)
                if recipe.totalMinutes != nil || !tags.isEmpty {
                    let meta = large
                        ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                        : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 12))
                    meta {
                        if let minutes = recipe.totalMinutes {
                            Label(Format.minutes(minutes), systemImage: "clock")
                                .labelStyle(SmallIconLabelStyle())
                                .fixedSize()
                        }
                        if !tags.isEmpty { tagLine.lineLimit(large ? 3 : 1) }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    /// "● vegan  ● süß": each tag after a dot in its colour.
    private var tagLine: Text {
        tags.enumerated().reduce(Text(verbatim: "")) { line, entry in
            let dot = Text(Image(systemName: "circle.fill")).font(.system(size: 7)).foregroundStyle(TagColor(entry.element).ink)
            let gap = entry.offset == 0 ? "" : "   "
            return Text("\(line)\(gap)\(dot)\u{00A0}\(entry.element)")
        }
    }

    private var accessibilityText: Text {
        var parts = [recipe.title]
        if let minutes = recipe.totalMinutes { parts.append(Format.minutes(minutes)) }
        if !tags.isEmpty { parts.append(String(localized: "Tags: \(tags.joined(separator: ", "))")) }
        return Text(verbatim: parts.joined(separator: ", "))
    }
}

/// A small quiet symbol close before its text: "◷ 35 min".
struct SmallIconLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            configuration.icon.imageScale(.small).foregroundStyle(.tertiary)
            configuration.title
        }
    }
}
