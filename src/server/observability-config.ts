import "server-only";
import {
  readObservabilityConfig,
  toClientObservabilityConfig,
  type ObservabilityClientConfig,
} from "@/domain/observability";

export function getObservabilityClientConfig(): ObservabilityClientConfig {
  return toClientObservabilityConfig(readObservabilityConfig(process.env));
}
