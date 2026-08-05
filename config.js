/**
 * 阿里云部署后填写：
 * 1) foodApiUrl = 函数计算 HTTP 地址
 * 页面请上传到 OSS 静态网站，并用 OSS/CDN 域名打开。
 */
const FOOD_API_URL = "在这里粘贴函数计算HTTP地址";

export function getFoodApiUrl() {
  return String(FOOD_API_URL || "").trim();
}

/** @deprecated */
export const sharedFoodApiUrl = FOOD_API_URL;
