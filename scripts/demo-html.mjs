// Writes demo/index.html for the static demo build: Tailwind CSS from the Next build, inlined.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";

const dir = ".next/static/css";
const css = readdirSync(dir).map((f) => readFileSync(`${dir}/${f}`, "utf8")).join("\n");
writeFileSync(
  "demo/index.html",
  `<title>Arda</title>
<style>
${css}
:root{color-scheme:dark;background:#04050c}html,body{background:#04050c;color:#f1f5f9}#root{min-height:100%}
</style>
<div id="root"></div>
<script src="game.js"></script>
`,
);
