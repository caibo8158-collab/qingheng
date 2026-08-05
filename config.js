/**
 * 页面：https://qingheng.caibo8158.workers.dev/
 * 饮食识别：复用已配置 API_KEY 的 Worker（同属 Cloudflare，国内一般比 github.io 稳）
 */
const FOOD_API = "https://long-term-8ca7.caibo8158.workers.dev";

export function getFoodApiUrl() {
  return FOOD_API;
}

/** @deprecated */
export const sharedFoodApiUrl = FOOD_API;
