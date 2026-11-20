/**
 * Draws the extension icons (design 21a: the "m." mark) with the local Google Chrome, headless,
 * into static/icons/. Run once after a logo change: node scripts/icons.mjs
 */
import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const dir = await mkdtemp(path.join(tmpdir(), "icons-"));
await copyFile("node_modules/@fontsource/bangers/files/bangers-latin-400-normal.woff2", path.join(dir, "bangers.woff2"));

// size: [tile, radius, font size, text, light tile]. 128 keeps Chrome's 16px clear margin.
const SPECS = { 16: [16, 4, 12, "m", true], 32: [32, 8, 22, "m", true], 48: [48, 12, 32, "m.", false], 128: [96, 22, 65, "m.", false] };
for (const [size, [tile, radius, font, text, light]] of Object.entries(SPECS)) {
  const html = `<!doctype html><html><head><style>
@font-face{font-family:B;src:url(bangers.woff2)}
html,body{margin:0;background:transparent}
body{width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center}
i{display:flex;align-items:center;justify-content:center;box-sizing:border-box;width:${tile}px;height:${tile}px;border-radius:${radius}px;
background:${light ? "#eef2ef" : "#07090a"};${light ? "" : "border:1px solid #2a312d;"}color:${light ? "#07090a" : "#eef2ef"};
font:normal ${font}px/1 B;font-style:normal;letter-spacing:0.02em}
</style></head><body><i>${text}</i></body></html>`;
  const file = path.join(dir, `${size}.html`);
  await writeFile(file, html);
  execFileSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--default-background-color=00000000",
    `--window-size=${size},${size}`, "--virtual-time-budget=3000", `--screenshot=${path.resolve(`static/icons/${size}.png`)}`, `file://${file}`], { stdio: "ignore" });
  console.log(`icons/${size}.png`);
}
