/**
 * Cloudflare Worker：解决浏览器直连大模型 API 的跨域问题。
 * 部署后把 Worker 地址填进「轻衡 → API 设置 → CORS 代理」。
 *
 * 前端会 POST：
 * {
 *   model, messages, temperature,
 *   targetUrl: "https://api.deepseek.com/v1/chat/completions"
 * }
 * Authorization: Bearer <你的 API Key>
 */
export default {
  async fetch(request) {
    const cors = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405, headers: cors });
    }

    try {
      const auth = request.headers.get("Authorization") || "";
      const body = await request.json();
      const targetUrl =
        body.targetUrl || "https://api.deepseek.com/v1/chat/completions";
      const { targetUrl: _omit, ...payload } = body;

      if (!/^https:\/\//i.test(targetUrl)) {
        return Response.json(
          { error: { message: "invalid targetUrl" } },
          { status: 400, headers: cors }
        );
      }

      const upstream = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: auth,
        },
        body: JSON.stringify(payload),
      });

      const text = await upstream.text();
      return new Response(text, {
        status: upstream.status,
        headers: {
          ...cors,
          "Content-Type": upstream.headers.get("Content-Type") || "application/json",
        },
      });
    } catch (err) {
      return Response.json(
        { error: { message: err?.message || "proxy error" } },
        { status: 500, headers: cors }
      );
    }
  },
};
