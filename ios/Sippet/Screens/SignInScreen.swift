import AuthenticationServices
import SippetCore
import SwiftUI

struct SignInScreen: View {
    let model: AppModel
    @Environment(\.webAuthenticationSession) private var webAuthenticationSession

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "fork.knife")
                .font(.system(size: 56))
                .foregroundStyle(.tint)
                .accessibilityHidden(true)
            Text("Sippet").font(.largeTitle.bold())
            Text("Your recipes, offline in the kitchen.")
                .foregroundStyle(.secondary)
            Spacer()
            if let error = model.signInError {
                Text(error).font(.callout).foregroundStyle(.red).multilineTextAlignment(.center)
            }
            Button {
                Task { await signIn() }
            } label: {
                Group {
                    if model.isSigningIn { ProgressView() } else { Text("Sign in with passkey") }
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
            .disabled(model.isSigningIn)
        }
        .padding(24)
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity)
    }

    private func signIn() async {
        model.isSigningIn = true
        model.signInError = nil
        defer { model.isSigningIn = false }
        do {
            let (signIn, url, verifier, state) = try await model.beginSignIn()
            let callback = try await webAuthenticationSession.authenticate(
                using: url, callback: .customScheme("de.bastelboxx.sippet"),
                preferredBrowserSession: .shared, additionalHeaderFields: [:])
            try await model.finishSignIn(signIn, callback: callback, verifier: verifier, state: state)
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            return
        } catch {
            model.signInError = String(localized: "Sign-in failed. Try again.")
        }
    }
}
