// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "SippetCore",
    platforms: [.macOS(.v15), .iOS("26.0")],
    products: [.library(name: "SippetCore", targets: ["SippetCore"])],
    targets: [
        .target(name: "SippetCore"),
        .testTarget(name: "SippetCoreTests", dependencies: ["SippetCore"]),
    ],
    swiftLanguageModes: [.v6]
)
