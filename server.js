const http = require("http");
const fs = require("fs/promises");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT || 5173);
const defaultBaseUrl = process.env.DEEPSEEK_API_BASE_URL || "https://api.deepseek.com";
const appVersion = "streaming-v2";
const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/api/deepseek/chat") {
      await proxyDeepSeek(req, res);
      return;
    }

    if (req.method === "POST" && req.url === "/api/cloud/webdav") {
      await proxyWebDav(req, res);
      return;
    }

    if (req.method === "GET" && req.url === "/api/health") {
      sendJson(res, 200, { ok: true, version: appVersion, streaming: true });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendJson(res, 405, { error: { message: "Method not allowed" } });
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: { message: error.message || "Internal server error" } });
  }
});

server.listen(port, () => {
  console.log(`每日食谱记录已启动：http://localhost:${port}`);
});

async function proxyDeepSeek(req, res) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    sendJson(res, 500, {
      error: {
        message: "缺少 DEEPSEEK_API_KEY。请先在命令行设置环境变量，再运行 node server.js。",
      },
    });
    return;
  }

  const body = await readBody(req);
  const payload = JSON.parse(body || "{}");
  const baseUrl = stripTrailingSlash(payload.baseUrl || defaultBaseUrl);
  delete payload.baseUrl;

  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  res.writeHead(upstream.status, {
    "Content-Type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Transfer-Encoding": "chunked",
    "X-Accel-Buffering": "no",
    "X-App-Version": appVersion,
    "Access-Control-Allow-Origin": "http://localhost:" + port,
  });

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  if (!upstream.ok || !payload.stream || !upstream.body) {
    const text = await upstream.text();
    res.end(text);
    return;
  }

  const reader = upstream.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (res.destroyed) break;
      res.write(Buffer.from(value));
      if (typeof res.flush === "function") {
        res.flush();
      }
    }
  } finally {
    if (!res.destroyed) res.end();
  }
}

async function proxyWebDav(req, res) {
  const body = await readBody(req);
  const payload = JSON.parse(body || "{}");
  const { method, cloud, data } = payload;

  if (!cloud?.url || !cloud?.username || !cloud?.password || !cloud?.path) {
    sendJson(res, 400, { error: { message: "云同步配置不完整" } });
    return;
  }

  const fileUrl = buildWebDavUrl(cloud.url, cloud.path);
  const auth = "Basic " + Buffer.from(`${cloud.username}:${cloud.password}`, "utf8").toString("base64");

  if (method === "PUT") {
    await ensureWebDavDirectories(cloud.url, cloud.path, auth);
    const upstream = await fetch(fileUrl, {
      method: "PUT",
      headers: {
        Authorization: auth,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(data, null, 2),
    });
    if (!upstream.ok && upstream.status !== 201 && upstream.status !== 204) {
      const text = await upstream.text();
      sendJson(res, upstream.status, { error: { message: text || `WebDAV 上传失败：HTTP ${upstream.status}` } });
      return;
    }
    sendJson(res, 200, { ok: true, method: "PUT" });
    return;
  }

  if (method === "GET") {
    const upstream = await fetch(fileUrl, {
      method: "GET",
      headers: { Authorization: auth },
    });
    if (!upstream.ok) {
      const text = await upstream.text();
      sendJson(res, upstream.status, { error: { message: text || `WebDAV 下载失败：HTTP ${upstream.status}` } });
      return;
    }
    const text = await upstream.text();
    try {
      sendJson(res, 200, JSON.parse(text));
    } catch {
      sendJson(res, 502, { error: { message: "云端文件不是有效 JSON" } });
    }
    return;
  }

  sendJson(res, 400, { error: { message: "不支持的云同步方法" } });
}

async function ensureWebDavDirectories(baseUrl, filePath, auth) {
  const parts = normalizeWebDavPath(filePath).split("/").filter(Boolean);
  parts.pop();
  let current = "";

  for (const part of parts) {
    current += `/${part}`;
    const response = await fetch(buildWebDavUrl(baseUrl, current), {
      method: "MKCOL",
      headers: { Authorization: auth },
    });
    if (![201, 405, 301, 302].includes(response.status) && !response.ok) {
      const text = await response.text();
      throw new Error(text || `创建云端目录失败：HTTP ${response.status}`);
    }
  }
}

function buildWebDavUrl(baseUrl, filePath) {
  const base = String(baseUrl).replace(/\/+$/, "");
  const encodedPath = normalizeWebDavPath(filePath)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
  return `${base}${encodedPath}`;
}

function normalizeWebDavPath(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/").replace(/\/+/g, "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(root, requestedPath));
  const relativePath = path.relative(root, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendJson(res, 403, { error: { message: "Forbidden" } });
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    if (req.method === "HEAD") res.end();
    else res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      const fallback = await fs.readFile(path.join(root, "index.html"));
      res.writeHead(200, {
        "Content-Type": mimeTypes[".html"],
        "Cache-Control": "no-store",
      });
      res.end(fallback);
      return;
    }
    throw error;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function stripTrailingSlash(value) {
  return String(value).replace(/\/+$/, "");
}
