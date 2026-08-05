/**
 * 饮食识别接口地址。
 * - Cloudflare Pages：同域 /api/food（推荐，国内更稳）
 * - 仍打开旧 GitHub Pages 时：回退到已有 Worker
 */
const PAGES_API = "/api/food";
const WORKER_FALLBACK = "https://long-term-8ca7.caibo8158.workers.dev";

export function getFoodApiUrl() {
  try {
    const host = String(location.hostname || "");
    if (host.includes("github.io")) return WORKER_FALLBACK;
    // pages.dev / 自定义域名 / 本地预览，一律走同域函数
    return PAGES_API;
  } catch {
    return PAGES_API;
  }
}

/** @deprecated 兼容旧引用；请优先用 getFoodApiUrl() */
export const sharedFoodApiUrl = PAGES_API;
