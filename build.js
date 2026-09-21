#!/usr/bin/env node
// Builds store-ready zips into ./build.
//
// Files are chosen by allowlist, not by excluding things: a new dev file can
// never leak into a package just because nobody remembered to exclude it.
// No dependencies and no shelling out, so it runs on Windows too.

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

const ROOT = __dirname;
const BUILD = path.join(ROOT, "build");

// Everything the extension needs at runtime, and nothing else.
const SHIP = [
  "manifest.json",
  "background.js",
  "popup.html",
  "popup.js",
  "theme.js",
  "icons/icon16.png",
  "icons/icon48.png",
  "icons/icon128.png",
];

// ── checks ────────────────────────────────────────────────────────────────────
function collectManifestAssets(node, found = new Set()) {
  if (typeof node === "string") {
    if (/\.(png|js|html|css|json)$/i.test(node) && !node.includes("://")) {
      found.add(node);
    }
  } else if (Array.isArray(node)) {
    node.forEach((child) => collectManifestAssets(child, found));
  } else if (node && typeof node === "object") {
    Object.values(node).forEach((child) => collectManifestAssets(child, found));
  }
  return found;
}

function verify(manifest) {
  const problems = [];

  for (const file of SHIP) {
    if (!fs.existsSync(path.join(ROOT, file))) {
      problems.push(`missing file: ${file}`);
    }
  }

  // 1.0.x shipped a manifest pointing at icons that were not in the repo, so
  // every asset the manifest names is checked before packaging.
  for (const asset of collectManifestAssets(manifest)) {
    if (asset === "manifest.json") continue;
    if (!fs.existsSync(path.join(ROOT, asset))) {
      problems.push(`manifest references missing asset: ${asset}`);
    } else if (!SHIP.includes(asset)) {
      problems.push(`manifest references ${asset}, which SHIP does not list`);
    }
  }

  const bg = manifest.background || {};
  if (bg.service_worker && !bg.scripts) {
    problems.push(
      "background.service_worker without background.scripts: Firefox will not run the background script",
    );
  }

  if (problems.length) {
    console.error("Build aborted:");
    problems.forEach((p) => console.error(`  - ${p}`));
    process.exit(1);
  }
}

// ── minimal zip writer (deflate, no zip64) ────────────────────────────────────
function makeCrc32() {
  if (zlib.crc32) return zlib.crc32;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) {
      c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
    }
    return (c ^ -1) >>> 0;
  };
}
const crc32 = makeCrc32();

function dosTime(date) {
  const time =
    (date.getHours() << 11) |
    (date.getMinutes() << 5) |
    (Math.floor(date.getSeconds() / 2) & 0x1f);
  const day =
    ((date.getFullYear() - 1980) << 9) |
    ((date.getMonth() + 1) << 5) |
    date.getDate();
  return { time, day };
}

function writeZip(outPath, entries) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const stamp = dosTime(new Date());
  const UTF8 = 0x0800; // flag bit 11: filename is UTF-8

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const deflated = zlib.deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const sum = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed to extract
    local.writeUInt16LE(UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.day, 12);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    chunks.push(local, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(0x031e, 4); // made by: unix, spec 3.0
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(UTF8, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(stamp.time, 12);
    dir.writeUInt16LE(stamp.day, 14);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30); // extra
    dir.writeUInt16LE(0, 32); // comment
    dir.writeUInt16LE(0, 34); // disk number
    dir.writeUInt16LE(0, 36); // internal attrs
    dir.writeUInt32LE(0o644 << 16, 38); // external attrs
    dir.writeUInt32LE(offset, 42);

    central.push(dir, nameBuf);
    offset += local.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4); // this disk
  end.writeUInt16LE(0, 6); // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20); // comment length

  fs.writeFileSync(outPath, Buffer.concat([...chunks, centralBuf, end]));
}

// ── build ─────────────────────────────────────────────────────────────────────
function entriesFor(manifest) {
  return SHIP.map((name) => ({
    name,
    data:
      name === "manifest.json"
        ? Buffer.from(JSON.stringify(manifest, null, 2) + "\n", "utf8")
        : fs.readFileSync(path.join(ROOT, name)),
  }));
}

function main() {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"),
  );
  verify(manifest);

  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });

  // One source manifest serves both browsers: Firefox reads background.scripts
  // and ignores service_worker, Chrome does the reverse. Chrome only warns
  // about the unknown gecko key, so it is dropped from the Chrome package to
  // keep the upload clean.
  const chromeManifest = structuredClone(manifest);
  delete chromeManifest.browser_specific_settings;

  console.log(`Download Router ${manifest.version}`);

  for (const [target, targetManifest] of [
    ["chrome", chromeManifest],
    ["firefox", manifest],
  ]) {
    const name = `download-router-${manifest.version}-${target}.zip`;
    const outPath = path.join(BUILD, name);
    writeZip(outPath, entriesFor(targetManifest));
    const kb = (fs.statSync(outPath).size / 1024).toFixed(1);
    console.log(`  build/${name}  (${kb} KB, ${SHIP.length} files)`);
  }

  // Unpacked copy for chrome://extensions during development.
  const unpacked = path.join(BUILD, "unpacked");
  for (const { name, data } of entriesFor(manifest)) {
    const dest = path.join(unpacked, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, data);
  }
  console.log(`  build/unpacked  (load unpacked from here)`);
}

main();
