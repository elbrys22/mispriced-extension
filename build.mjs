/**
 * Builds the extension into dist/ (load it from chrome://extensions → Load unpacked), or with
 * --zip also packs dist/ for the Chrome Web Store. --watch rebuilds on every change.
 * Everything the extension runs is in this package: the venue math is in shared/.
 */
import * as esbuild from "esbuild";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

const watch = process.argv.includes("--watch");
const zip = process.argv.includes("--zip");
const pkg = JSON.parse(await readFile("package.json", "utf8"));

await rm("dist", { recursive: true, force: true });
await mkdir("dist/fonts", { recursive: true });
await cp("static", "dist", { recursive: true });
await cp("venues", "dist/venues", { recursive: true });
for (const f of ["inter/files/inter-latin-400-normal", "inter/files/inter-latin-500-normal", "inter/files/inter-latin-600-normal", "bangers/files/bangers-latin-400-normal"])
  await cp(`node_modules/@fontsource/${f}.woff2`, `dist/fonts/${f.split("/").pop()}.woff2`);
const manifest = JSON.parse(await readFile("static/manifest.json", "utf8"));
await writeFile("dist/manifest.json", JSON.stringify({ ...manifest, version: pkg.version }, null, 2));

const options = {
  entryPoints: { background: "src/background.ts", panel: "src/panel.tsx", popup: "src/popup.tsx" },
  bundle: true,
  outdir: "dist",
  format: "esm",
  target: "chrome116",
  jsx: "automatic",
  tsconfig: "tsconfig.json",
  define: { "process.env.NODE_ENV": '"production"' },
  // Readable output: the store reviews what runs.
  minify: false,
  legalComments: "none",
  logLevel: "info",
};

// The venue pages' content script can't be a module: its own classic-script build.
const content = { ...options, entryPoints: { content: "src/content.ts" }, format: "iife" };

if (watch) {
  for (const o of [options, content]) await (await esbuild.context(o)).watch();
} else {
  await Promise.all([esbuild.build(options), esbuild.build(content)]);
  if (zip) {
    const out = `mispriced-extension-${pkg.version}.zip`;
    await rm(out, { force: true });
    execFileSync("zip", ["-r", "-X", "-q", `../${out}`, "."], { cwd: "dist" });
    console.log(`packed ${out}`);
  }
}
