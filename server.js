// A URL shortener: POST / creates a short key, GET /<key> redirects, DELETE /<key> removes it. Links are stored in a file so they survive restarts.
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");

const PORT = Number(process.env.PORT || 8080);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const DB_FILE = process.env.DB_FILE || "links.json";
const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

const links = fs.existsSync(DB_FILE) ? JSON.parse(fs.readFileSync(DB_FILE, "utf8")) : {};

function save() {
  fs.writeFileSync(`${DB_FILE}.tmp`, JSON.stringify(links));
  fs.renameSync(`${DB_FILE}.tmp`, DB_FILE);
}

// The first 64 bits of a SHA-256 hash, written as 7 base-62 characters.
function keyFor(url, salt) {
  const digest = crypto.createHash("sha256").update(salt ? `${url}#${salt}` : url).digest();
  let n = digest.readBigUInt64BE(0);
  let key = "";
  for (let i = 0; i < 7; i++) {
    key += ALPHABET[Number(n % 62n)];
    n /= 62n;
  }
  return key;
}

function send(res, status, body) {
  const json = typeof body === "object";
  res.writeHead(status, { "Content-Type": json ? "application/json" : "text/plain" });
  res.end(json ? JSON.stringify(body) : body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

async function create(req, res) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return send(res, 400, { error: "The body must be JSON" });
  }
  if (!body || typeof body.url !== "string") return send(res, 400, { error: "Missing field: url" });
  let target;
  try {
    target = new URL(body.url);
  } catch {
    return send(res, 400, { error: "Not a valid URL" });
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") return send(res, 400, { error: "Only http and https URLs" });

  // Same URL, same key. A key taken by a different URL is a collision: hash again with a salt.
  let salt = 0;
  let key = keyFor(body.url, salt);
  while (links[key] && links[key] !== body.url) key = keyFor(body.url, ++salt);
  const isNew = !links[key];
  if (isNew) {
    links[key] = body.url;
    save();
  }
  return send(res, isNew ? 201 : 200, { key, long_url: body.url, short_url: `${BASE_URL}/${key}` });
}

const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, BASE_URL).pathname;
  if (req.method === "POST" && path === "/") return create(req, res);
  if (req.method === "GET" && path === "/") return send(res, 200, "URL shortener is running\n");
  const key = path.slice(1);
  if (req.method === "GET" && key) {
    const target = links[key];
    if (!target) return send(res, 404, "URL not found");
    // 302, not 301: browsers would cache a permanent redirect and never ask again, so a later change or delete would be ignored.
    res.writeHead(302, { Location: target });
    return res.end();
  }
  if (req.method === "DELETE" && key) {
    // Deleting a key that isn't there changes nothing, so a retried DELETE is safe and still succeeds.
    if (links[key]) {
      delete links[key];
      save();
    }
    return send(res, 200, "");
  }
  return send(res, 404, "Not found");
});

server.listen(PORT, () => console.log(`listening on ${PORT}`));
