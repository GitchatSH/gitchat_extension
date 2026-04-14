// @ts-check
// `vscode` already declared by shared.js (acquireVsCodeApi called once)

document.getElementById("cta-btn").addEventListener("click", () => {
  vscode.postMessage({ type: "signIn" });
});
