import * as vscode from "vscode";
import type { ExtensionModule } from "../types";
import { configManager } from "../config";
import { log } from "../utils";

const SECRET_KEY = "gitchat.githubToken";
const SECRET_LOGIN = "gitchat.login";
const GITHUB_SCOPES = ["read:user", "user:email", "public_repo", "user:follow"];

class AuthManager {
  private _token: string | null = null;
  private _login: string | null = null;
  private _gitchatToken: string | null = null;
  private _secrets!: vscode.SecretStorage;
  private readonly _onDidChangeAuth = new vscode.EventEmitter<boolean>();
  readonly onDidChangeAuth = this._onDidChangeAuth.event;

  get isSignedIn(): boolean {
    return this._token !== null;
  }

  /** GitHub access token — works as Bearer token for both GitHub API and Gitchat API */
  get token(): string | null {
    return this._token;
  }

  get login(): string | null {
    return this._login;
  }

  get gitchatToken(): string | null {
    return this._gitchatToken;
  }

  async init(secrets: vscode.SecretStorage): Promise<void> {
    this._secrets = secrets;

    const saved = await secrets.get(SECRET_KEY);
    if (saved) {
      this._token = saved;
      this._login = (await secrets.get(SECRET_LOGIN)) ?? null;
      this._gitchatToken = (await secrets.get("gitchat.gitchatToken")) || null;
      this._onDidChangeAuth.fire(true);
      log(`Restored session: ${this._login ?? "unknown"}`);
    }
  }

  async signIn(): Promise<boolean> {
    try {
      // Try built-in auth first (works in VS Code with GitHub auth provider)
      let accessToken: string;
      let login: string;

      try {
        const session = await vscode.authentication.getSession(
          "github",
          GITHUB_SCOPES,
          {
            // clearSessionPreference: true,
            createIfNone: true,
          },
        );
        if (!session) {
          return false;
        }
        accessToken = session.accessToken;
        login = session.account.label;
      } catch {
        // Fallback: custom device flow with better UX
        const result = await this._deviceFlowSignIn();
        if (!result) {
          return false;
        }
        accessToken = result.accessToken;
        login = result.login;
      }

      this._token = accessToken;
      this._login = login;
      await this._secrets.store(SECRET_KEY, accessToken);
      await this._secrets.store(SECRET_LOGIN, this._login);
      this._onDidChangeAuth.fire(true);
      log(`Signed in as ${this._login}`);
      vscode.window.showInformationMessage(`Signed in as ${this._login}`);

      // Silent Gitchat auth link
      try {
        const { default: axios } = await import("axios");
        log(
          `Calling github-link at ${configManager.current.apiUrl}/auth/github-link`,
        );
        // Detect IDE name from env
        const appName = vscode.env.appName?.toLowerCase() ?? "";
        let ide = "vscode";
        if (appName.includes("cursor")) {
          ide = "cursor";
        } else if (appName.includes("windsurf")) {
          ide = "windsurf";
        } else if (appName.includes("antigravity")) {
          ide = "antigravity";
        } else if (appName.includes("void")) {
          ide = "void";
        }

        const response = await axios.post(
          `${configManager.current.apiUrl}/auth/github-link`,
          {
            github_token: this._token,
            client_id: `gitchat@${vscode.extensions.getExtension("Gitchat.gitchat")?.packageJSON?.version ?? "unknown"}`,
            ide,
            ide_version: vscode.version,
          },
        );
        log(
          `github-link response: ${JSON.stringify(response.data)?.slice(0, 200)}`,
        );
        // Backend wraps response in { data: { access_token, login }, statusCode, message }
        const resData = response.data?.data || response.data;
        this._gitchatToken = resData?.access_token || resData?.token || null;
        if (this._gitchatToken) {
          await this._secrets.store("gitchat.gitchatToken", this._gitchatToken);
          log(
            `Gitchat auth linked successfully, token: ${this._gitchatToken.slice(0, 20)}...`,
          );
        } else {
          log(`Gitchat auth link: no token in response`, "warn");
        }
      } catch (err) {
        log(`Gitchat auth link failed: ${err}`, "warn");
      }

      // Sync GitHub follows to Gitchat in background
      this._syncToGitchat();

      // WP3: Onboarding logic handled by explore.ts (onDidChangeAuth + ready handler)
      // Just focus the Explore panel after a short delay for UI to settle
      setTimeout(() => {
        vscode.commands.executeCommand("gitchat.explore.focus");
      }, 1500);

      return true;
    } catch (err) {
      log(`Sign in failed: ${err}`, "error");
      vscode.window.showErrorMessage(`Sign in failed: ${err}`);
      return false;
    }
  }

  private async _deviceFlowSignIn(): Promise<{
    accessToken: string;
    login: string;
  } | null> {
    const { default: axios } = await import("axios");

    // Step 1: Request device code from GitHub
    const codeRes = await axios.post(
      "https://github.com/login/device/code",
      {
        client_id: configManager.current.githubClientId,
        scope: GITHUB_SCOPES.join(" "),
      },
      { headers: { Accept: "application/json" } },
    );

    const { device_code, user_code, verification_uri, interval } = codeRes.data;

    // Step 2: Show code with Copy & Open button
    await vscode.env.clipboard.writeText(user_code);
    const action = await vscode.window.showInformationMessage(
      `Your GitHub login code: **${user_code}** (copied to clipboard!)`,
      { modal: false },
      "Open GitHub",
    );

    if (action === "Open GitHub") {
      vscode.env.openExternal(vscode.Uri.parse(verification_uri));
    }

    // Step 3: Poll for token
    const pollInterval = (interval || 5) * 1000;
    const maxAttempts = 120;
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, pollInterval));
      try {
        const tokenRes = await axios.post(
          "https://github.com/login/oauth/access_token",
          {
            client_id: configManager.current.githubClientId,
            device_code,
            grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          },
          { headers: { Accept: "application/json" } },
        );

        if (tokenRes.data.access_token) {
          const userRes = await axios.get("https://api.github.com/user", {
            headers: { Authorization: `Bearer ${tokenRes.data.access_token}` },
          });
          return {
            accessToken: tokenRes.data.access_token,
            login: userRes.data.login,
          };
        }

        if (tokenRes.data.error === "authorization_pending") {
          continue;
        }
        if (tokenRes.data.error === "slow_down") {
          await new Promise((r) => setTimeout(r, 5000));
          continue;
        }
        break; // expired_token, access_denied, etc.
      } catch {
        break;
      }
    }

    vscode.window.showErrorMessage("GitHub login timed out or was cancelled.");
    return null;
  }

  private async _syncToGitchat(): Promise<void> {
    try {
      const { apiClient } = await import("../api");
      const result = await apiClient.syncGitHubFollows();
      log(`Sync raw result: ${JSON.stringify(result)?.slice(0, 300)}`);
      log(
        `Synced to Gitchat: ${result?.imported_following} following, ${result?.imported_followers} followers, ${result?.mutual} mutual`,
      );
      await apiClient.sendHeartbeat().catch(() => {});
    } catch (err) {
      log(`Gitchat sync skipped: ${err}`, "warn");
    }

    // WP11: kick off GitHub data pre-fetch in the background (non-blocking).
    import("../github-data")
      .then((m) => m.githubDataCache.refreshAll())
      .catch((err) =>
        log(`[GithubData] background refresh failed: ${err}`, "warn"),
      );
  }

  async signOut(): Promise<void> {
    const prevLogin = this._login;
    this._token = null;
    this._login = null;
    this._gitchatToken = null;
    await this._secrets.delete(SECRET_KEY);
    await this._secrets.delete(SECRET_LOGIN);
    await this._secrets.delete("gitchat.gitchatToken");
    await this._secrets.delete("trending.gitchatToken");

    // WP11: purge any cached GitHub data tied to the previous login.
    if (prevLogin) {
      try {
        const { githubDataCache } = await import("../github-data");
        await githubDataCache.clearForUser(prevLogin);
      } catch (err) {
        log(`[GithubData] clearForUser failed: ${err}`, "warn");
      }
    }

    this._onDidChangeAuth.fire(false);
    log("Signed out");
    vscode.window.showInformationMessage("Signed out.");
  }

  dispose(): void {
    this._onDidChangeAuth.dispose();
  }
}

export const authManager = new AuthManager();

export const authModule: ExtensionModule = {
  id: "auth",
  async activate(context) {
    await authManager.init(context.secrets);
    vscode.commands.executeCommand(
      "setContext",
      "gitchat.isSignedIn",
      authManager.isSignedIn,
    );
    authManager.onDidChangeAuth((signedIn) => {
      vscode.commands.executeCommand(
        "setContext",
        "gitchat.isSignedIn",
        signedIn,
      );
    });
    context.subscriptions.push(authManager);
  },
};
