#!/usr/bin/env node

/**
 * Detects this machine's current LAN IPv4 address and rewrites
 * EXPO_PUBLIC_BACKEND_URL in .env to point at it (keeping the existing
 * port). Runs automatically before `expo start` via package.json so the
 * .env never goes stale after the router hands out a new DHCP address.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");
const envExamplePath = path.join(root, ".env.example");

const IGNORED_INTERFACE_PATTERN =
  /virtualbox|vmware|hyper-v|vethernet|loopback|tailscale|zerotier|docker|wsl/i;

function findLanIPv4() {
  const interfaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!addresses || IGNORED_INTERFACE_PATTERN.test(name)) continue;
    for (const addr of addresses) {
      if (addr.family === "IPv4" && !addr.internal) {
        candidates.push({ name, address: addr.address });
      }
    }
  }

  return candidates;
}

function main() {
  const candidates = findLanIPv4();

  if (candidates.length === 0) {
    console.warn(
      "[update-backend-ip] No LAN IPv4 address found — leaving .env untouched. " +
        "Make sure you're connected to Wi-Fi/Ethernet."
    );
    return;
  }

  const { name, address } = candidates[0];
  if (candidates.length > 1) {
    console.warn(
      `[update-backend-ip] Multiple network interfaces found, using "${name}" (${address}). ` +
        `Others: ${candidates
          .slice(1)
          .map((c) => `${c.name}=${c.address}`)
          .join(", ")}`
    );
  }

  if (!fs.existsSync(envPath)) {
    if (!fs.existsSync(envExamplePath)) {
      console.warn("[update-backend-ip] No .env or .env.example found — skipping.");
      return;
    }
    fs.copyFileSync(envExamplePath, envPath);
  }

  const content = fs.readFileSync(envPath, "utf8");
  const lineRegex = /^EXPO_PUBLIC_BACKEND_URL=.*$/m;
  const match = content.match(lineRegex);
  const previousPort = match ? match[0].match(/:(\d+)\s*$/)?.[1] : null;
  const port = previousPort || "3001";
  const newLine = `EXPO_PUBLIC_BACKEND_URL=http://${address}:${port}`;

  if (match && match[0] === newLine) {
    console.log(`[update-backend-ip] .env already up to date (${address}:${port}).`);
    return;
  }

  const newContent = match
    ? content.replace(lineRegex, newLine)
    : `${content.trimEnd()}\n${newLine}\n`;

  fs.writeFileSync(envPath, newContent);
  console.log(`[update-backend-ip] Updated .env -> ${newLine}`);
}

main();
