import SippetCore
import SwiftUI

/// Sidebar | a stack rooted at the sidebar's choice. Recipes and folders push onto the stack with a zoom out of
/// their tile. iPhone collapses the sidebar into the same stack.
struct LibraryScreen: View {
    let model: AppModel
    @State private var selection: SidebarItem? = .all
    @State private var path: [LibraryRoute] = []
    @State private var showSettings = false
    @State private var renaming: OrganizeTarget?
    @State private var newName = ""
    @State private var deleting: OrganizeTarget?
    @State private var columns: NavigationSplitViewVisibility = .automatic
    @State private var shownNotice: ChangeNotice?
    @Namespace private var zoom

    private var store: LibraryStore { model.store }

    var body: some View {
        NavigationSplitView(columnVisibility: $columns) {
            // Choosing in the sidebar starts the stack over; a rename keeps it.
            LibrarySidebar(model: model, selection: Binding(get: { selection }, set: { selection = $0; path = [] }), showSettings: $showSettings)
        } detail: {
            NavigationStack(path: $path) {
                root
                    .navigationDestination(for: LibraryRoute.self, destination: destination)
            }
        }
        .environment(\.zoomNamespace, zoom)
        .environment(\.organize, OrganizeActions(rename: startRename, delete: { deleting = $0 }))
        .environment(\.open) { path.append($0) }
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
        .task { await debugSelect() }
        .task { await DemoChurn.run(store: store) }
        #endif
    }

    #if DEBUG
    /// `-SippetSelect sidebar|trash|collection:<name>|smart:<name>|tag:<name>`, `-SippetSettings`, `-SippetColumns` (iPad: sidebar shown),
    /// `-SippetPush recipe:<title prefix>|folder:<name>` (after `-SippetPushDelay <s>`, default 0.6; `-SippetPop <s>`
    /// pops again after that long). Screenshots and recordings only.
    private func debugSelect() async {
        let args = ProcessInfo.processInfo.arguments
        func value(_ flag: String) -> String? {
            args.firstIndex(of: flag).flatMap { $0 + 1 < args.count ? args[$0 + 1] : nil }
        }
        if args.contains("-SippetSettings") { showSettings = true }
        if args.contains("-SippetColumns") { columns = .all }
        if let select = value("-SippetSelect") {
            let name = select.split(separator: ":", maxSplits: 1).dropFirst().first.map(String.init) ?? ""
            switch select.split(separator: ":").first {
            case "sidebar": selection = nil
            case "trash": selection = .trash
            case "collection": selection = .collection(name)
            case "smart": selection = .smart(name)
            case "tag": selection = .tag(name)
            default: break
            }
        }
        guard let push = value("-SippetPush") else { return }
        try? await Task.sleep(for: .seconds(Double(value("-SippetPushDelay") ?? "") ?? 0.6))
        let name = push.split(separator: ":", maxSplits: 1).dropFirst().first.map(String.init) ?? ""
        if push.hasPrefix("folder:") {
            let item: SidebarItem = store.organization.smartCollections.contains { $0.name == name } ? .smart(name) : .collection(name)
            path.append(.list(item))
        } else if let recipe = store.library.first(where: { $0.title.lowercased().hasPrefix(name.lowercased()) }) {
            path.append(.recipe(recipe.id, zoom: "\((selection ?? .all).key)/\(recipe.id)"))
        }
        if let pop = Double(value("-SippetPop") ?? "") {
            try? await Task.sleep(for: .seconds(pop))
            path.removeAll()
        }
    }
    #endif

    // MARK: the stack

    @ViewBuilder private var root: some View {
        switch selection ?? .all {
        case .trash: TrashScreen(model: model)
        case let item: RecipeList(model: model, item: item)
        }
    }

    @ViewBuilder private func destination(_ route: LibraryRoute) -> some View {
        switch route {
        case .recipe(let id, let source):
            recipePage(id).zoomed(from: source, in: zoom)
        case .list(let item):
            RecipeList(model: model, item: item).zoomed(from: LibraryRoute.folderZoom(item), in: zoom)
        }
    }

    @ViewBuilder private func recipePage(_ id: String) -> some View {
        if let recipe = store.recipes[id], recipe.trashedAt == nil {
            RecipeScreen(recipe: recipe).id(recipe.id)
        } else if store.recipes[id] != nil {
            ContentUnavailableView("In the trash", systemImage: "trash", description: Text("Restore it from the trash to read it again."))
        } else {
            ContentUnavailableView("This recipe is gone.", systemImage: "fork.knife")
        }
    }

    // MARK: rename and delete (library 6, 8, 12)

    private var renamePrompt: LocalizedStringKey {
        renaming?.kind == .collection ? "Rename collection" : "Rename tag"
    }

    private func startRename(_ target: OrganizeTarget) {
        guard !model.isOffline else { model.alertMessage = String(localized: "Offline"); return }
        newName = target.name
        renaming = target
    }

    private func rename() {
        let name = newName.trimmingCharacters(in: .whitespaces)
        guard let target = renaming, !name.isEmpty, name != target.name else { return }
        let edit: LibraryEdit = target.kind == .tag
            ? .renameTag(tag: target.name, to: name)
            : .renameCollection(collection: target.name, to: name)
        let renamed = OrganizeTarget(kind: target.kind, name: name).item
        Task {
            guard await model.edit([edit]) else { return }
            if selection == target.item { selection = renamed }
            path = path.map { $0 == .list(target.item) ? .list(renamed) : $0 }
        }
    }

    private func delete(_ target: OrganizeTarget) {
        guard !model.isOffline else { model.alertMessage = String(localized: "Offline"); return }
        let edit: LibraryEdit = target.kind == .tag ? .deleteTag(tag: target.name) : .deleteCollection(collection: target.name)
        Task {
            guard await model.edit([edit]) else { return }
            if selection == target.item { selection = .all }
            if let at = path.firstIndex(of: .list(target.item)) { path.removeSubrange(at...) }
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
                    if notice.recipeIds.count == 1, let id = notice.recipeIds.first {
                        path.append(.recipe(id, zoom: nil))
                    }
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
            if model.isOffline, !model.isConnecting {
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

private extension View {
    /// The zoom out of the tile named `source`; a plain push without one.
    @ViewBuilder func zoomed(from source: String?, in namespace: Namespace.ID) -> some View {
        if let source {
            navigationTransition(.zoom(sourceID: source, in: namespace))
        } else {
            self
        }
    }
}
