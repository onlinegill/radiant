import Foundation
// Run against the reader in this build (apps/ios/.../RemoteCatalog.swift).
var fail = 0
func ok(_ c: Bool, _ what: String) { if c { print("  ok   \(what)") } else { fail += 1; print("  FAIL \(what)") } }
let data = try! Data(contentsOf: URL(fileURLWithPath: "apps/ios/catalog.json"))
let doc = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
let models = (doc["models"] as! [[String: Any]]).map { $0["id"] as! String }
let gated = ((doc["gated"] as? [[String: Any]]) ?? []).map { ($0["id"] as! String, $0["minBuild"] as? Int ?? Int.max) }
let top = gated.map(\.1).max() ?? 0
ok(RemoteCatalog.decode(data, build: 21)?.map(\.id) == models, "an old build number gets the main list only")
ok(RemoteCatalog.decode(data, build: top)?.map(\.id) == models + gated.map(\.0), "a build that qualifies gets the gated rows too, after the main list")
let j = { (s: String) in s.data(using: .utf8)! }
ok(RemoteCatalog.decode(j(#"{"schema":1,"models":[{"id":"a","name":"A","repo":"o/a","gb":1}]}"#))?.first?.vision == false,
   "a row without vision, video, maker or blurb is read, with defaults — not the whole list thrown away")
ok(RemoteCatalog.decode(j(#"{"schema":1,"models":[{"id":"a","name":"A","repo":"o/a","gb":1}],"gated":[{"id":"b","name":"B","repo":"o/b","gb":1}]}"#), build: 999)?.map(\.id) == ["a"],
   "a gated row with no minBuild is never offered")
ok(RemoteCatalog.decode(j(#"{"schema":1,"models":[{"id":"a","name":"A","repo":"o/a","gb":0}]}"#)) == nil, "a row with no size is still rejected — the progress bar divides by it")
ok(RemoteCatalog.decode(j(#"{"schema":2,"models":[{"id":"a","name":"A","repo":"o/a","gb":1}]}"#)) == nil, "an unknown schema is still ignored")
let r = RemoteCatalog.Row(id: "x", name: "X", repo: "o/x")
ok(r.gb == 0 && !r.vision, "a row can still be built by hand, as addCustom does")
exit(fail == 0 ? 0 : 1)
