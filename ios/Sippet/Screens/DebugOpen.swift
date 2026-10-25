#if DEBUG
import SippetCore
import SwiftUI

/// Launch argument `-SippetOpen recipe:<id|title prefix>`, or `cook:<id>:<step>` opens (`table:` is DebugOpenTable) that screen directly.
/// Add `-SippetTimer` to start the opened step's timer. Screenshots only.
struct DebugOpen: ViewModifier {
    let model: AppModel
    @State private var target: Target?

    struct Target: Identifiable {
        let id = UUID()
        let kind: String
        let recipe: DeviceRecipe
        let step: Int
    }

    func body(content: Content) -> some View {
        content
            .task {
                let args = ProcessInfo.processInfo.arguments
                guard let at = args.firstIndex(of: "-SippetOpen"), at + 1 < args.count else { return }
                let parts = args[at + 1].split(separator: ":").map(String.init)
                guard parts.count >= 2, parts[0] != "table" else { return }
                for _ in 0..<50 {
                    if let recipe = model.store.library.first(where: {
                        $0.id == parts[1] || $0.title.lowercased().hasPrefix(parts[1].lowercased())
                    }) {
                        target = Target(kind: parts[0], recipe: recipe, step: parts.count > 2 ? Int(parts[2]) ?? 0 : 0)
                        return
                    }
                    try? await Task.sleep(for: .milliseconds(200))
                }
            }
            .fullScreenCover(item: $target) { target in
                switch target.kind {
                case "cook":
                    CookModeScreen(recipe: target.recipe, units: .asWritten, startAt: target.step)
                default:
                    NavigationStack { RecipeScreen(recipe: target.recipe) }
                }
            }
    }
}
#endif
