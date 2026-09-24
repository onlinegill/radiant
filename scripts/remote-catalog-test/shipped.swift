import Foundation
// Run against the FROZEN reader that App Store 1.1 through build 27 use.
var fail = 0
func ok(_ c: Bool, _ what: String) { if c { print("  ok   \(what)") } else { fail += 1; print("  FAIL \(what)") } }
let data = try! Data(contentsOf: URL(fileURLWithPath: "apps/ios/catalog.json"))
let doc = try! JSONSerialization.jsonObject(with: data) as! [String: Any]
let models = (doc["models"] as! [[String: Any]]).map { $0["id"] as! String }
let gated = ((doc["gated"] as? [[String: Any]]) ?? []).map { $0["id"] as! String }
let rows = RemoteCatalog.decode(data)
ok(rows != nil, "the phones already out there can read the published list (it used to reject the whole thing)")
ok(rows?.map(\.id) == models, "and they get every main-list row, in order (\(rows?.count ?? 0) of \(models.count))")
ok(!(rows ?? []).contains { gated.contains($0.id) }, "but none of the rows gated to newer builds (\(gated.joined(separator: ", ")))")
exit(fail == 0 ? 0 : 1)
