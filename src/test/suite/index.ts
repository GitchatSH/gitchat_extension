import * as path from "path";
import Mocha from "mocha";

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: "tdd", color: true, timeout: 10000 });
  const testsRoot = path.resolve(__dirname);

  const fs = await import("fs");
  const files = fs.readdirSync(testsRoot).filter(f => f.endsWith(".test.js"));

  for (const f of files) {
    mocha.addFile(path.resolve(testsRoot, f));
  }

  return new Promise<void>((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) { reject(new Error(`${failures} tests failed.`)); }
      else { resolve(); }
    });
  });
}
