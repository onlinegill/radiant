// Can the phone's engine build this model? Run by scripts/catalog-check.py.
//
// ⚠️ "THE ENGINE LISTS THIS MODEL TYPE" IS NOT "THE ENGINE CAN LOAD THIS MODEL".
// Nemotron 3 Nano 4B's type, nemotron_h, was registered, so the catalogue check
// passed — and every phone that downloaded its 2 GB then failed with "Failed to
// parse config.json": the engine's reader required four keys only the big MoE
// Nemotron has. This builds each model the way the app does, from its real
// config.json, with the exact engine revision the app pins: the vision reader
// first, then the text one, as loadModelContainer tries them. No weights and no
// GPU are needed — a reader that rejects the file fails here, in seconds.
//
// Usage: engine-check id=path/to/config.json ...   (prints OK/FAIL per model)
import Foundation
import MLXLLM
import MLXVLM

for arg in CommandLine.arguments.dropFirst() {
    let parts = arg.split(separator: "=", maxSplits: 1).map(String.init)
    guard parts.count == 2, let data = FileManager.default.contents(atPath: parts[1]) else {
        print("FAIL \(arg): unreadable argument"); continue
    }
    let type = ((try? JSONSerialization.jsonObject(with: data)) as? [String: Any])?["model_type"] as? String ?? ""
    var last = "no reader for model_type '\(type)'"
    var ok = false
    do { _ = try await VLMTypeRegistry.shared.createModel(configuration: data, modelType: type); ok = true } catch { }
    if !ok {
        do { _ = try await LLMTypeRegistry.shared.createModel(configuration: data, modelType: type); ok = true }
        catch { last = "\(error)" }
    }
    print(ok ? "OK   \(parts[0])" : "FAIL \(parts[0]): \(last)")
}
