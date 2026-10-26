import ActivityKit
import AlarmKit
import AppIntents
import SwiftUI
import WidgetKit

/// The countdown of a cook-mode timer on the Lock Screen, in StandBy and in the Dynamic Island (cooking 5).
/// The ring and its Stop are the system's alert; this draws the time before it.
struct CookTimerActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CookTimerAttributes.self) { context in
            LockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Titles(metadata: context.attributes.metadata).padding(.leading, 6)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Cancel(context: context).padding(.trailing, 6)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Countdown(mode: context.state.mode)
                        .font(.system(size: 44, weight: .semibold, design: .rounded))
                        .foregroundStyle(context.attributes.tintColor)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 6)
                }
            } compactLeading: {
                Image(systemName: "timer").foregroundStyle(context.attributes.tintColor)
            } compactTrailing: {
                Countdown(mode: context.state.mode)
                    .font(.system(.body, design: .rounded, weight: .semibold))
                    .foregroundStyle(context.attributes.tintColor)
                    .frame(maxWidth: 56)
            } minimal: {
                Ring(mode: context.state.mode, tint: context.attributes.tintColor)
            }
            .keylineTint(context.attributes.tintColor)
        }
    }
}

private struct LockScreenView: View {
    let context: ActivityViewContext<CookTimerAttributes>

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Titles(metadata: context.attributes.metadata)
                Countdown(mode: context.state.mode)
                    .font(.system(size: 44, weight: .semibold, design: .rounded))
                    .foregroundStyle(context.attributes.tintColor)
            }
            Spacer(minLength: 8)
            Cancel(context: context)
        }
        .padding(16)
    }
}

private struct Titles: View {
    let metadata: CookTimerMetadata?

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(metadata?.stepTitle ?? "")
                .font(.headline)
                .lineLimit(1)
            Text(metadata?.recipeTitle ?? "")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
    }
}

/// The time left, counting by itself (no updates from the app).
private struct Countdown: View {
    let mode: AlarmPresentationState.Mode

    var body: some View {
        Group {
            switch mode {
            case .countdown(let countdown):
                Text(timerInterval: Date.now...max(countdown.fireDate, .now), countsDown: true)
            case .paused(let paused):
                let left = Duration.seconds(paused.totalCountdownDuration - paused.previouslyElapsedDuration)
                Text(left.formatted(.time(pattern: left > .seconds(3600) ? .hourMinuteSecond : .minuteSecond)))
            default:
                Text("Time is up")
            }
        }
        .monospacedDigit()
        .lineLimit(1)
        .minimumScaleFactor(0.6)
    }
}

private struct Ring: View {
    let mode: AlarmPresentationState.Mode
    let tint: Color

    var body: some View {
        Group {
            if case .countdown(let countdown) = mode {
                ProgressView(
                    timerInterval: Date.now...max(countdown.fireDate, .now), countsDown: true,
                    label: { EmptyView() },
                    currentValueLabel: { Image(systemName: "timer").scaleEffect(0.8) })
            } else {
                Image(systemName: "bell.fill")
            }
        }
        .progressViewStyle(.circular)
        .foregroundStyle(tint)
        .tint(tint)
    }
}

private struct Cancel: View {
    let context: ActivityViewContext<CookTimerAttributes>

    var body: some View {
        Button(intent: StopCookTimerIntent(alarmID: context.state.alarmID.uuidString)) {
            Image(systemName: "xmark")
                .font(.title3.weight(.semibold))
                .frame(width: 44, height: 44)
        }
        .buttonStyle(.plain)
        .foregroundStyle(.secondary)
        .accessibilityLabel(Text("Cancel timer"))
    }
}
