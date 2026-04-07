// @ts-check
const vscode = acquireVsCodeApi();

document.getElementById("cta-btn").addEventListener("click", () => {
  vscode.postMessage({ type: "signIn" });
});
