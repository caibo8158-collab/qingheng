/**
 * 轻衡：静态页面 + /api/food 饮食识别
 * 密钥：Cloudflare → Settings → Variables → API_KEY (Secret)
 */
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const memoryHits = new Map();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function dayKeyCST() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

async function hitRateLimit(env, ip, limit) {
  const day = dayKeyCST();
  const key = `rl:${day}:${ip}`;
  const bucket = memoryHits.get(key) || 0;
  if (bucket >= limit) return true;
  memoryHits.set(key, bucket + 1);
  if (memoryHits.size > 5000) {
    for (const k of memoryHits.keys()) {
      if (!k.includes(`:${day}:`)) memoryHits.delete(k);
    }
  }
  return false;
}

async function handleFoodApi(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== "POST") {
    return json({ error: { message: "Method Not Allowed" } }, 405);
  }

  const apiKey = env.API_KEY;
  if (!apiKey) {
    return json({ error: { message: "服务端未配置 API_KEY" } }, 500);
  }

  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";

  const limit = Number(env.RATE_LIMIT || 5);
  if (await hitRateLimit(env, ip, limit)) {
    return json(
      { error: { message: "今日免费识别次数已用完（每天 5 次），明天再来吧" } },
      429
    );
  }

  try {
    const body = await request.json();
    const messages = Array.isArray(body.messages) ? body.messages : null;
    if (!messages || !messages.length) {
      return json({ error: { message: "messages 不能为空" } }, 400);
    }

    const userText =
      [...messages].reverse().find((m) => m.role === "user")?.content || "";
    if (typeof userText !== "string" || userText.trim().length < 1) {
      return json({ error: { message: "请输入食物描述" } }, 400);
    }
    if (userText.length > 200) {
      return json({ error: { message: "输入过长" } }, 400);
    }

    const base = String(env.BASE_URL || "https://api.deepseek.com/v1").replace(
      /\/+$/,
      ""
    );
    const upstream = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: env.MODEL || "deepseek-chat",
        temperature: 0.2,
        messages,
      }),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: {
        ...cors,
        "Content-Type":
          upstream.headers.get("Content-Type") || "application/json",
      },
    });
  } catch (err) {
    return json({ error: { message: err?.message || "proxy error" } }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/food" || url.pathname === "/api/food/") {
      return handleFoodApi(request, env);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }
    return new Response("Not Found", { status: 404 });
  },
};
