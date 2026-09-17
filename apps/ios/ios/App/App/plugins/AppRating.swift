import Foundation
import Capacitor
import StoreKit
import UIKit

/**
 * Asking for a rating, at the one moment it is fair to ask.
 *
 * ⚠️ RATINGS ARE A RANKING INPUT, AND RADIANT HAS NONE. A day after release the
 * app was findable by its own name only at #17 for "Radiant Local" and nowhere
 * in the top 40 for anything else — it is indexed, it just ranks nowhere, which
 * is what happens to an app with no downloads and no ratings. Tony: "people
 * need to be able to find the app." The keyword field is the other lever and
 * only he can set it; this is the half that can be built.
 *
 * ⚠️ AND IT MUST NEVER BE A NAG. Apple's own rule is that you ask after the
 * person has had a good experience, never on launch, never mid-task, and never
 * because you want something. `requestReview` is rate-limited by the system to
 * three prompts a year and may show nothing at all — so the caller must treat
 * it as a hint that cannot fail and must never block or branch on it.
 *
 * The moment chosen (see useLocalModels) is a model finishing a download AND
 * the person having already had a real conversation: they have seen the thing
 * work twice, on their own device, with nothing having gone wrong.
 */
@objc(AppRating)
public class AppRating: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "AppRating"
    public let jsName = "AppRating"
    // ⚠️ A method missing from this list compiles, links, and is still refused
    // at runtime. See the same note in LocalModels.swift.
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "request", returnType: CAPPluginReturnPromise)
    ]

    @objc func request(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // The scene, not the app: on iPadOS there can be more than one, and
            // asking on the wrong one shows the prompt where nobody is looking.
            guard let scene = UIApplication.shared.connectedScenes
                .first(where: { $0.activationState == .foregroundActive }) as? UIWindowScene else {
                return call.resolve(["asked": false])
            }
            if #available(iOS 18.0, *) {
                AppStore.requestReview(in: scene)
            } else {
                SKStoreReviewController.requestReview(in: scene)
            }
            // "asked" means Radiant asked the system, NOT that a prompt
            // appeared — the system decides that and never tells us.
            call.resolve(["asked": true])
        }
    }
}
