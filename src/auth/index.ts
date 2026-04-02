import * as vscode from "vscode";
import type { ExtensionModule } from "../types";
import { log } from "../utils";
import { configManager } from "../config";
import axios from "axios";

const SECRET_KEY = "trending.jwt";
const GITHUB_SCOPES = ["read:user", "user:email"];

class AuthManager {
  private _jwt: string | null = null;
  private _secrets!: vscode.SecretStorage;
  private readonly _onDidChangeAuth = new vscode.EventEmitter<boolean>();
  readonly onDidChangeAuth = this._onDidChangeAuth.event;

  get isSignedIn(): boolean {
    return this._jwt !== null;
  }

  get token(): string | null {
    return this._jwt;
  }

  async init(secrets: vscode.SecretStorage): Promise<void> {
    this._secrets = secrets;
    const stored = await secrets.get(SECRET_KEY);
    if (stored) {
      this._jwt = stored;
      this._onDidChangeAuth.fire(true);
      log("Restored JWT from SecretStorage");
    }
  }

  async signIn(): Promise<boolean> {
    try {
      const session = await vscode.authentication.getSession("github", GITHUB_SCOPES, {
        createIfNone: true,
      });

      if (!session) {
        return false;
      }

      const { apiUrl } = configManager.current;
      const response = await axios.post(
        `${apiUrl}/api-keys`,
        { github_token: session.accessToken },
        { timeout: 10000 }
      );

      this._jwt = response.data.token ?? response.data.access_token;
      if (!this._jwt) {
        throw new Error("No token in auth response");
      }

      await this._secrets.store(SECRET_KEY, this._jwt);
      this._onDidChangeAuth.fire(true);
      log(`Signed in as ${session.account.label}`);
      vscode.window.showInformationMessage(`Signed in as ${session.account.label}`);
      return true;
    } catch (err) {
      log(`Sign in failed: ${err}`, "error");
      vscode.window.showErrorMessage("Sign in failed. Please try again.");
      return false;
    }
  }

  async signOut(): Promise<void> {
    this._jwt = null;
    await this._secrets.delete(SECRET_KEY);
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
    vscode.commands.executeCommand("setContext", "trending.isSignedIn", authManager.isSignedIn);
    authManager.onDidChangeAuth((signedIn) => {
      vscode.commands.executeCommand("setContext", "trending.isSignedIn", signedIn);
    });
    context.subscriptions.push(authManager);
  },
};
