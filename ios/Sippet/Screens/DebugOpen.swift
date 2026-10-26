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
            .overlay {
                if ProcessInfo.processInfo.arguments.contains("-SippetGallery") { ArtGallery() }
            }
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

/// `-SippetGallery`: 24 arts in a grid, to judge the generator. Screenshots only.
/// `-SippetGalleryBench`: 300 tiles at list size, scrolled top to bottom in 4 s; prints the frame times.
struct ArtGallery: View {
    private let bench = ProcessInfo.processInfo.arguments.contains("-SippetGalleryBench")
    @State private var position = ScrollPosition(edge: .top)

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: bench ? 64 : 110), spacing: 8)], spacing: 8) {
                ForEach(0..<(bench ? 300 : 24), id: \.self) { i in
                    RecipeArtView(id: "rcp_demo_\(i * 7919)")
                        .aspectRatio(ArtGeometry.heroAspect, contentMode: .fit)
                        .clipShape(.rect(cornerRadius: 12))
                }
            }
            .padding(12)
        }
        .scrollPosition($position)
        .background(Color(.systemBackground))
        .task {
            guard bench else { return }
            try? await Task.sleep(for: .seconds(1.5))
            let meter = FrameMeter()
            meter.start()
            withAnimation(.linear(duration: 4)) { position.scrollTo(edge: .bottom) }
            try? await Task.sleep(for: .seconds(4.2))
            print(meter.stop())
        }
    }
}

/// Frame intervals from a display link: the median and the frames that took over 1.5 refresh intervals.
@MainActor private final class FrameMeter: NSObject {
    private var link: CADisplayLink?
    private var times: [CFTimeInterval] = []

    func start() {
        link = CADisplayLink(target: self, selector: #selector(tick))
        link?.add(to: .main, forMode: .common)
    }

    @objc private func tick(_ link: CADisplayLink) { times.append(link.timestamp) }

    func stop() -> String {
        link?.invalidate()
        let deltas = zip(times.dropFirst(), times).map { ($0 - $1) * 1000 }.sorted()
        guard !deltas.isEmpty else { return "SippetBench no frames" }
        let median = deltas[deltas.count / 2]
        let slow = deltas.filter { $0 > median * 1.5 }.count
        return String(format: "SippetBench frames %d median %.2f ms p99 %.2f ms max %.2f ms slow %d",
                      deltas.count, median, deltas[Int(Double(deltas.count - 1) * 0.99)], deltas.last!, slow)
    }
}

/// `-SippetScrollEnd`: lists and the recipe page start at their end. Screenshots only.
enum DebugScroll {
    static var anchor: UnitPoint? { ProcessInfo.processInfo.arguments.contains("-SippetScrollEnd") ? .bottom : nil }
}
#endif
