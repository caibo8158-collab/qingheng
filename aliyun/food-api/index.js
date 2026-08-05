/**
 * 阿里云函数计算（FC）HTTP 函数：饮食识别代理
 * 控制台配置环境变量：API_KEY（必填）、BASE_URL、MODEL、RATE_LIMIT（可选）
 */
const memoryHits = new Map();

function dayKeyCST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function hitRateLimit(ip, limit) {
  const day = dayKeyCST();
  const key = `rl:${day}:${ip}`;
  const n = memoryHits.get(key) || 0;
  if (n >= limit) return true;
  memoryHits.set(key, n + 1);
  return false;
}

function parseEvent(event) {
  if (Buffer.isBuffer(event)) {
    return JSON.parse(event.toString("utf8"));
  }
  if (typeof event === "string") {
    return JSON.parse(event);
  }
  return event || {};
}

function readBody(evt) {
  if (!evt.body) return {};
  const raw = evt.isBase64Encoded
    ? Buffer.from(evt.body, "base64").toString("utf8")
    : evt.body;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function ok(body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  };
}

exports.handler = async (event, context) => {
  const evt = parseEvent(event);
  const method = (
    evt.requestContext?.http?.method ||
    evt.httpMethod ||
    evt.method ||
    "GET"
  ).toUpperCase();

  if (method === "OPTIONS") {
    return ok("", 204);
  }
  if (method !== "POST") {
    return ok({ error: { message: "Method Not Allowed" } }, 405);
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    return ok({ error: { message: "服务端未配置 API_KEY" } }, 500);
  }

  const headers = evt.headers || {};
  const ip =
    headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
    headers["X-Forwarded-For"]?.split(",")[0]?.trim() ||
    context?.requestId ||
    "unknown";

  const limit = Number(process.env.RATE_LIMIT || 5);
  if (hitRateLimit(ip, limit)) {
    return ok(
      { error: { message: "今日免费识别次数已用完（每天 5 次），明天再来吧" } },
      429
    );
  }

  try {
    const body = readBody(evt);
    const messages = Array.isArray(body.messages) ? body.messages : null;
    if (!messages || !messages.length) {
      return ok({ error: { message: "messages 不能为空" } }, 400);
    }

    const userText =
      [...messages].reverse().find((m) => m.role === "user")?.content || "";
    if (typeof userText !== "string" || userText.trim().length < 1) {
      return ok({ error: { message: "请输入食物描述" } }, 400);
    }
    if (userText.length > 200) {
      return ok({ error: { message: "输入过长" } }, 400);
    }

    const base = String(
      process.env.BASE_URL || "https://api.deepseek.com/v1"
    ).replace(/\/+$/, "");
    const model = process.env.MODEL || "deepseek-chat";

    const upstream = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages,
      }),
    });

    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: {
        "Content-Type":
          upstream.headers.get("Content-Type") ||
          "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
      body: text,
    };
  } catch (err) {
    return ok({ error: { message: err?.message || "proxy error" } }, 500);
  }
};
