import SwiftUI
import WidgetKit

/**
 The pet on the home screen: its picture in its place (cut out of the family's
 own video, standing in the meadow or the place they chose) and the next day to
 remember. The app writes both into the shared app group; the widget works out
 "today", "tomorrow" or "in N days" itself, so it stays right between visits.
 Nothing is said on ordinary days beyond the next remembrance day.
 */

private let appGroup = "group.app.kinsong.pets"

private struct Shared: Decodable {
  struct Day: Decodable {
    let date: String // yyyy-MM-dd, local
    let title: String
  }
  let name: String
  let days: [Day]
}

struct PetEntry: TimelineEntry {
  let date: Date
  let name: String
  let line: String
  let picture: UIImage?
}

struct Provider: TimelineProvider {
  /** Before the app has shared anything. */
  private static let empty = PetEntry(date: Date(), name: "Your friend", line: "Resting in the garden", picture: nil)

  func placeholder(in context: Context) -> PetEntry {
    Self.empty
  }

  func getSnapshot(in context: Context, completion: @escaping (PetEntry) -> Void) {
    completion(entry(on: Date()))
  }

  /** A week of entries, one per day, so "in N days" counts down without the app. */
  func getTimeline(in context: Context, completion: @escaping (Timeline<PetEntry>) -> Void) {
    let calendar = Calendar.current
    let start = calendar.startOfDay(for: Date())
    var entries = [entry(on: Date())]
    for n in 1..<8 {
      entries.append(entry(on: calendar.date(byAdding: .day, value: n, to: start)!))
    }
    completion(Timeline(entries: entries, policy: .atEnd))
  }

  private func entry(on date: Date) -> PetEntry {
    let dir = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
    guard let dir,
          let data = try? Data(contentsOf: dir.appendingPathComponent("widget.json")),
          let shared = try? JSONDecoder().decode(Shared.self, from: data)
    else { return Self.empty }
    let picture = UIImage(contentsOfFile: dir.appendingPathComponent("widget.png").path)
    return PetEntry(date: date, name: shared.name, line: line(for: shared.days, on: date), picture: picture)
  }

  private func line(for days: [Shared.Day], on date: Date) -> String {
    let calendar = Calendar.current
    let today = calendar.startOfDay(for: date)
    let format = DateFormatter()
    format.dateFormat = "yyyy-MM-dd"
    let next = days
      .compactMap { d in format.date(from: d.date).map { (day: calendar.startOfDay(for: $0), title: d.title) } }
      .filter { $0.day >= today }
      .min { $0.day < $1.day }
    guard let next else { return "Resting in the garden" }
    let n = calendar.dateComponents([.day], from: today, to: next.day).day ?? 0
    switch n {
    case 0: return next.title
    case 1: return "Tomorrow: \(next.title)"
    default: return "\(next.title) · in \(n) days"
    }
  }
}

struct PetWidgetView: View {
  var entry: PetEntry
  @Environment(\.widgetFamily) private var family

  var body: some View {
    VStack(alignment: .leading, spacing: 2) {
      Spacer()
      Text(entry.name)
        .font(.headline.weight(.semibold))
        .foregroundStyle(.white)
      Text(entry.line)
        .font(family == .systemSmall ? .caption2 : .caption)
        .foregroundStyle(.white.opacity(0.92))
        .lineLimit(2)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(14)
    .shadow(color: .black.opacity(0.35), radius: 3, y: 1)
    .containerBackground(for: .widget) {
      ZStack(alignment: .bottom) {
        if let picture = entry.picture {
          Image(uiImage: picture)
            .resizable()
            .aspectRatio(contentMode: .fill)
        } else {
          LinearGradient(colors: [Color(red: 0.75, green: 0.89, blue: 0.96), Color(red: 0.55, green: 0.78, blue: 0.47)], startPoint: .top, endPoint: .bottom)
        }
        LinearGradient(colors: [.clear, .black.opacity(0.55)], startPoint: .center, endPoint: .bottom)
      }
    }
  }
}

@main
struct KinsongWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "KinsongWidget", provider: Provider()) { entry in
      PetWidgetView(entry: entry)
    }
    .configurationDisplayName("In the garden")
    .description("Your friend, and the next day to remember them.")
    .supportedFamilies([.systemSmall, .systemMedium])
    .contentMarginsDisabled()
  }
}
