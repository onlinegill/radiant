import UIKit
import Capacitor

// ⚠️ WITHOUT THIS THE APP DIES AT LAUNCH ON iOS 27. Build 23 (2026-09-18) was
// the first one compiled against the iOS 27 SDK, and on Tony's iPhone it
// trapped before the first frame: UIKit's
// __UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption, SIGTRAP.
// The iOS 27 SDK refuses the pre-scene app lifecycle that Capacitor's template
// still ships. The Main storyboard is unchanged; this delegate only owns the
// window and forwards the two things Capacitor used to get from the app
// delegate — URL opens and Universal Links.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard scene is UIWindowScene else { return }
        // the storyboard named in UISceneStoryboardFile has already built the window
        for context in connectionOptions.urlContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
        for activity in connectionOptions.userActivities {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for context in URLContexts {
            _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: context.url, options: [:])
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: userActivity, restorationHandler: { _ in })
    }
}
