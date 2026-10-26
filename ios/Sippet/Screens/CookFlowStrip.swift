import SippetCore
import SwiftUI

/// Cook mode's "you are here" (ios.md Cook mode): one segment per step in the author's order, laid in the lanes of the
/// recipe page's rail, so a parallel part (Füllung beside Teig) runs on a second line and meets the first where its
/// step takes both. Done steps tinted, the current one marked, the rest quiet. A tap anywhere on the strip jumps to the
/// step under the finger; VoiceOver adjusts it step by step.
struct CookFlowStrip: View {
    let recipe: DeviceRecipe
    @Binding var index: Int

    private static let segment: CGFloat = 4
    private static let current: CGFloat = 8
    private static let laneGap: CGFloat = 10
    private static let gap: CGFloat = 3

    var body: some View {
        let rail = FlowRail(recipe)
        let lanes = recipe.hasFlow ? min(rail.lanes, 3) : 1
        let height = CGFloat(lanes - 1) * Self.laneGap + Self.current
        GeometryReader { geo in
            let count = max(recipe.steps.count, 1)
            let width = geo.size.width / CGFloat(count)
            let lane = { (i: Int) in recipe.hasFlow ? min(rail.rows[i].lane, lanes - 1) : 0 }
            let y = { (i: Int) in CGFloat(lane(i)) * Self.laneGap + Self.current / 2 }
            ZStack(alignment: .topLeading) {
                // Where a result travels to a later step or another lane: a hairline from the end of one segment to
                // the start of the other.
                Path { p in
                    guard recipe.hasFlow else { return }
                    for (to, sources) in rail.takesFrom.enumerated() {
                        for from in sources where lane(from) != lane(to) || to > from + 1 {
                            let start = CGPoint(x: CGFloat(from + 1) * width - Self.gap, y: y(from))
                            let end = CGPoint(x: CGFloat(to) * width, y: y(to))
                            p.move(to: start)
                            if start.y == end.y {
                                p.addLine(to: end)
                            } else {
                                let mid = (start.x + end.x) / 2
                                p.addCurve(to: end, control1: CGPoint(x: mid, y: start.y), control2: CGPoint(x: mid, y: end.y))
                            }
                        }
                    }
                }
                .stroke(Color(.tertiaryLabel), lineWidth: 1)
                ForEach(recipe.steps.indices, id: \.self) { i in
                    let isCurrent = i == index
                    Capsule()
                        .fill(i < index ? AnyShapeStyle(.tint.opacity(0.45)) : isCurrent ? AnyShapeStyle(.tint) : AnyShapeStyle(Color(.systemFill)))
                        .frame(width: max(width - Self.gap, 2), height: isCurrent ? Self.current : Self.segment)
                        .position(x: CGFloat(i) * width + (width - Self.gap) / 2, y: y(i))
                }
            }
            .frame(height: height, alignment: .top)
            .frame(maxHeight: .infinity)
            .contentShape(.rect)
            .gesture(SpatialTapGesture().onEnded { tap in
                let i = min(max(Int(tap.location.x / width), 0), recipe.steps.count - 1)
                withAnimation { index = i }
            })
        }
        .frame(height: max(height, 60)) // the close button's height: a target at arm's length
        .animation(.easeOut(duration: 0.2), value: index)
        .accessibilityElement()
        .accessibilityLabel(Text("Step \(index + 1) of \(recipe.steps.count)"))
        .accessibilityValue(Text(recipe.steps.indices.contains(index) ? stepText(recipe.steps[index]) : ""))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment: if index < recipe.steps.count - 1 { withAnimation { index += 1 } }
            case .decrement: if index > 0 { withAnimation { index -= 1 } }
            @unknown default: break
            }
        }
    }
}
