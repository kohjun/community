import "server-only";
import { readAdvertisingConfiguration } from "@/domain/advertising";

export function getAdvertisingConfiguration() {
  return readAdvertisingConfiguration(process.env);
}
