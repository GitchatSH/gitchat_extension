const esbuild = require("esbuild");
require("dotenv").config();

const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

const esbuildProblemMatcherPlugin = {
  name: "esbuild-problem-matcher",
  setup(build) {
    build.onStart(() => {
      console.log("[watch] build started");
    });
    build.onEnd((result) => {
      result.errors.forEach(({ text, location }) => {
        console.error(`\u2718 [ERROR] ${text}`);
        if (location) {
          console.error(`    ${location.file}:${location.line}:${location.column}:`);
        }
      });
      console.log("[watch] build finished");
    });
  },
};

async function main() {
  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    format: "cjs",
    minify: production,
    sourcemap: !production,
    sourcesContent: false,
    platform: "node",
    outfile: "dist/extension.js",
    external: ["vscode"],
    logLevel: "silent",
    plugins: [esbuildProblemMatcherPlugin],
    define: {
      "process.env.GITCHAT_API_URL": JSON.stringify(process.env.GITCHAT_API_URL),
      "process.env.GITCHAT_WS_URL": JSON.stringify(process.env.GITCHAT_WS_URL),
      "process.env.GITCHAT_WEBAPP_URL": JSON.stringify(process.env.GITCHAT_WEBAPP_URL),
      "process.env.GITCHAT_GITHUB_CLIENT_ID": JSON.stringify(process.env.GITCHAT_GITHUB_CLIENT_ID),
    },
  });

  if (watch) {
    await ctx.watch();
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
