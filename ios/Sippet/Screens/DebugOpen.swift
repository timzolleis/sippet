#if DEBUG
import SippetCore
import SwiftUI

/// Launch argument `-SippetOpen recipe:<id|title prefix>`, or `cook:<id>:<step>` opens (`table:` is DebugOpenTable) that screen directly.
/// Add `-SippetTimer` to start the opened step's timer, `-SippetShopping` to open Einkaufen,
/// `-SippetLandscape` to turn the window to landscape, `-SippetLabelsOnly` to drop every step's sentence (a recipe without them). Screenshots only.
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
                if args.contains("-SippetLandscape") {
                    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
                    scene?.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight)) { _ in }
                }
                guard let at = args.firstIndex(of: "-SippetOpen"), at + 1 < args.count else { return }
                let parts = args[at + 1].split(separator: ":").map(String.init)
                guard parts.count >= 2, parts[0] != "table" else { return }
                for _ in 0..<50 {
                    if let recipe = model.store.library.first(where: {
                        $0.id == parts[1] || $0.title.lowercased().hasPrefix(parts[1].lowercased())
                    }) {
                        var recipe = recipe
                        if args.contains("-SippetLabelsOnly") {
                            recipe.steps = recipe.steps.map { var step = $0; step.sentence = nil; return step }
                        }
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

/// `-SippetScrollEnd`: lists and the recipe page start at their end. Screenshots only.
enum DebugScroll {
    static var anchor: UnitPoint? { ProcessInfo.processInfo.arguments.contains("-SippetScrollEnd") ? .bottom : nil }
}
#endif
