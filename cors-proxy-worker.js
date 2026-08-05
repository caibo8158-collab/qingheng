/**
 * Cloudflare Worker：把大模型 Key 留在服务端，访客无需自行配置。
 *
 * 部署：
 * 1. Cloudflare Dashboard → Workers → Create
 * 2. 粘贴本文件，或用 wrangler deploy
 * 3. Settings → Variables：
 *    - API_KEY = 你的 DeepSeek / OpenAI 兼容密钥（Secret）
 *    - BASE_URL = https://api.deepseek.com/v1   （可选）
 *    - MODEL = deepseek-chat                    （可选）
 *    - RATE_LIMIT = 40                          （每小时每 IP 次数，可选）
 * 4. 把 Worker 地址写入前端 config.js 的 sharedFoodApiUrl
 */
export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return json({ error: { message: "Method Not Allowed" } }, 405, cors);
    }

    const apiKey = env.API_KEY;
    if (!apiKey) {
      return json(
        { error: { message: "服务端未配置 API_KEY" } },
        500,
        cors
      );
    }

    const ip =
      request.headers.get("CF-Connecting-IP") ||
      request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
      "unknown";

    const limit = Number(env.RATE_LIMIT || 40);
    const limited = await hitRateLimit(env, ip, limit);
    if (limited) {
      return json(
        { error: { message: "今日调用过于频繁，请稍后再试" } },
        429,
        cors
      );
    }

    try {
      const body = await request.json();
      const messages = Array.isArray(body.messages) ? body.messages : null;
      if (!messages || !messages.length) {
        return json({ error: { message: "messages 不能为空" } }, 400, cors);
      }

      // 只允许饮食识别这种短对话，降低滥用空间
      const userText = [...messages].reverse().find((m) => m.role === "user")?.content || "";
      if (typeof userText !== "string" || userText.trim().length < 1) {
        return json({ error: { message: "请输入食物描述" } }, 400, cors);
      }
      if (userText.length > 200) {
        return json({ error: { message: "输入过长" } }, 400, cors);
      }

      const base = String(env.BASE_URL || "https://api.deepseek.com/v1").replace(
        /\/+$/,
        ""
      );
      const targetUrl = `${base}/chat/completions`;
      const model = env.MODEL || "deepseek-chat";

      const upstream = await fetch(targetUrl, {
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
      return new Response(text, {
        status: upstream.status,
        headers: {
          ...cors,
          "Content-Type":
            upstream.headers.get("Content-Type") || "application/json",
        },
      });
    } catch (err) {
      return json(
        { error: { message: err?.message || "proxy error" } },
        500,
        cors
      );
    }
  },
};

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

/** 简易每小时限额；有 KV 时更稳，无 KV 时用内存（单隔离内有效） */
const memoryHits = new Map();

async function hitRateLimit(env, ip, limit) {
  const hour = Math.floor(Date.now() / 3600000);
  const key = `rl:${hour}:${ip}`;

  if (env.RATE_KV) {
    const current = Number((await env.RATE_KV.get(key)) || 0);
    if (current >= limit) return true;
    await env.RATE_KV.put(key, String(current + 1), { expirationTtl: 3700 });
    return false;
  }

  const bucket = memoryHits.get(key) || 0;
  if (bucket >= limit) return true;
  memoryHits.set(key, bucket + 1);
  if (memoryHits.size > 5000) {
    for (const k of memoryHits.keys()) {
      if (!k.includes(`:${hour}:`)) memoryHits.delete(k);
    }
  }
  return false;
}
