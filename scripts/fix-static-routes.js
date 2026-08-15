#!/usr/bin/env node
// EAS Hosting's static file server resolves an extensionless request like
// "/foo" directly to "foo.html" when that file exists, but does NOT fall
// back to "foo/index.html" for a bare "/foo" (only "/foo/" with a trailing
// slash resolves to the directory's index.html). Every Expo Router route
// backed by a directory's index.tsx (e.g. app/booking/roadside-help/index.tsx)
// therefore 404s on a direct load or refresh without a trailing slash.
//
// This script runs after `expo export --platform web` and duplicates each
// such route's generated index.html to a flat sibling "<dir>.html" file, so
// the same extensionless-to-.html resolution that already serves flat routes
// (e.g. booking/ride-category.html) also serves these directory routes,
// without changing any visible URL or app route file.
const fs = require("fs");
const path = require("path");

const DIST_DIR = path.join(__dirname, "..", "dist");

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const full = path.join(dir, entry.name);
    const indexHtml = path.join(full, "index.html");
    if (fs.existsSync(indexHtml)) {
      const flatTarget = `${full}.html`;
      if (fs.existsSync(flatTarget)) {
        console.warn(`[fix-static-routes] skip ${path.relative(DIST_DIR, flatTarget)}: file already exists`);
      } else {
        fs.copyFileSync(indexHtml, flatTarget);
        console.log(`[fix-static-routes] ${path.relative(DIST_DIR, indexHtml)} -> ${path.relative(DIST_DIR, flatTarget)}`);
      }
    }
    walk(full);
  }
}

if (!fs.existsSync(DIST_DIR)) {
  console.error("[fix-static-routes] dist/ not found. Run `npx expo export --platform web` first.");
  process.exit(1);
}

walk(DIST_DIR);
