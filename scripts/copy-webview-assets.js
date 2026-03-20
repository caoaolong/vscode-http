"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const srcDir = path.join(root, "node_modules", "jsoneditor", "dist");
const outDir = path.join(root, "resources", "vendor");

const files = [
  "jsoneditor.min.js",
  "jsoneditor.min.css",
  path.join("img", "jsoneditor-icons.svg"),
];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function copyAsset(fileName) {
  const from = path.join(srcDir, fileName);
  const to = path.join(outDir, fileName);

  if (!fs.existsSync(from)) {
    throw new Error(`Missing source asset: ${from}`);
  }

  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

function main() {
  ensureDir(outDir);
  for (const fileName of files) {
    copyAsset(fileName);
  }
  console.log("Copied JSONEditor assets to resources/vendor");
}

main();
