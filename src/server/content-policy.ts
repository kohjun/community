import { evaluateContentPolicy } from "../domain/content-policy";
import { contentPolicyFields, ContentPolicyInputError } from "../domain/content-policy-fields";
import { AppError } from "./errors";
export { contentPolicyFields } from "../domain/content-policy-fields";

/** Synchronous server enforcement on validated publication payloads only. */
export function assertContentAllowed(input: unknown): void {
  try {
    const result = evaluateContentPolicy(contentPolicyFields(input));
    if (!result.allowed) throw new AppError("VALIDATION", result.message);
  } catch (error) {
    if (error instanceof ContentPolicyInputError) throw new AppError("VALIDATION", error.message);
    throw error;
  }
}
