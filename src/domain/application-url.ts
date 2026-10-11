import { z } from "zod";

export const applicationUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        /^https?:\/\//i.test(value) &&
        ["http:", "https:"].includes(url.protocol) &&
        !!url.hostname &&
        !url.username &&
        !url.password &&
        !/[\s\\]/.test(value)
      );
    } catch {
      return false;
    }
  }, "http:// 또는 https://로 시작하는 올바른 신청 링크를 입력해주세요.")
  .transform((value) => new URL(value).href);
