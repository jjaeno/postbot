export interface ProviderResult {
  readonly provider: string;
  readonly idempotencyKey: string;
  readonly createdAt: string;
}
