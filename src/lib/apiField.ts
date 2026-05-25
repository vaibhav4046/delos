// B12 · single source of truth for prompt-shaped fields.
//
// History: routes accepted variously `prompt`, `goal`, `command`, `transcript`,
// `text`, `query`, `input`. Clients drifted across versions and integration
// surface area exploded. Per the 2026-05-25 brutal-QA verdict we canonicalize
// on `input` and accept legacy fields with a `Deprecation: true` header
// returned to the caller.
//
// Usage:
//   const { body, deprecation } = normalizeInputField(rawBody);
//   const parsed = bodySchema.safeParse(body);
//   ...
//   return Response.json(payload, { headers: deprecation });

const LEGACY_FIELDS = ["prompt", "goal", "command", "transcript", "text", "query"] as const;
type LegacyField = (typeof LEGACY_FIELDS)[number];

export type Normalized<T extends Record<string, unknown>> = {
  body: T & { prompt: string; input: string };
  deprecation: HeadersInit;
  deprecatedField: LegacyField | null;
};

export function normalizeInputField<T extends Record<string, unknown>>(
  raw: unknown,
): Normalized<T> {
  const obj = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as T;
  // Canonical preference: `input` wins. If absent, lift from the first
  // legacy field that has a string value and tag the response with
  // Deprecation: true so SDK callers see the migration warning.
  let value = typeof obj.input === "string" ? obj.input : undefined;
  let deprecated: LegacyField | null = null;
  if (!value) {
    for (const f of LEGACY_FIELDS) {
      const v = (obj as Record<string, unknown>)[f];
      if (typeof v === "string" && v.length > 0) {
        value = v;
        deprecated = f;
        break;
      }
    }
  }
  const result = { ...(obj as Record<string, unknown>) } as Record<string, unknown>;
  if (value !== undefined) {
    result.input = value;
    result.prompt = value; // mirror so existing zod schemas (prompt:) keep working
  }
  return {
    body: result as T & { prompt: string; input: string },
    deprecation: deprecated
      ? { Deprecation: "true", "X-DelOS-Legacy-Field": deprecated }
      : {},
    deprecatedField: deprecated,
  };
}
