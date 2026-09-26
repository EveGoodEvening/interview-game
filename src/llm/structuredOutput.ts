/**
 * Claude structured outputs: `output_config.format` built from a zod schema.
 *
 * Built with `z.toJSONSchema` rather than the SDK's `zodOutputFormat` helper, which (SDK 0.128) moves
 * `enum` into the description text and so leaves enum fields (turn kind, expression, dimension key)
 * unconstrained on the wire. Loaded lazily together with the SDK (see anthropic.ts), and imports
 * `toJSONSchema` by name so the bundle keeps zod tree-shaken.
 */
import type Anthropic from '@anthropic-ai/sdk';
import { toJSONSchema, type z } from 'zod';

type JsonFormat = Anthropic.JSONOutputFormat;

const formatCache = new WeakMap<z.ZodType, JsonFormat | null>();

/** Keywords structured outputs rejects (numeric / string / complex array constraints) or that carry no meaning on the wire. */
const UNSUPPORTED_KEYWORDS = [
  '$schema',
  '$id',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'default',
] as const;
/** String formats structured outputs understands; any other `format` is dropped. */
const SUPPORTED_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);
const SUBSCHEMA_LISTS = ['anyOf', 'allOf', 'oneOf', 'prefixItems'] as const;
const SUBSCHEMA_MAPS = ['properties', '$defs', 'definitions'] as const;

type JsonSchemaNode = Record<string, unknown>;

function isSchemaNode(value: unknown): value is JsonSchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Make a JSON Schema acceptable to Claude structured outputs, in place: every object is closed
 * (`additionalProperties: false`), unsupported constraints are removed (the caller validates them
 * with zod anyway), `minItems` survives only as 0 or 1. `enum` / `const` / `required` / `description` stay.
 */
export function toStructuredOutputSchema(node: JsonSchemaNode): JsonSchemaNode {
  for (const key of UNSUPPORTED_KEYWORDS) delete node[key];
  // zod emits `oneOf` for discriminated unions; structured outputs documents `anyOf` (same meaning for disjoint branches).
  if (Array.isArray(node.oneOf) && node.anyOf === undefined) {
    node.anyOf = node.oneOf;
    delete node.oneOf;
  }
  if (typeof node.minItems === 'number' && node.minItems > 1) delete node.minItems;
  if (typeof node.format === 'string' && !SUPPORTED_FORMATS.has(node.format)) delete node.format;
  const types = Array.isArray(node.type) ? node.type : [node.type];
  if (types.includes('object') || isSchemaNode(node.properties)) node.additionalProperties = false;
  for (const key of SUBSCHEMA_MAPS) {
    const map = node[key];
    if (isSchemaNode(map)) for (const child of Object.values(map)) if (isSchemaNode(child)) toStructuredOutputSchema(child);
  }
  for (const key of SUBSCHEMA_LISTS) {
    const list = node[key];
    if (Array.isArray(list)) for (const child of list) if (isSchemaNode(child)) toStructuredOutputSchema(child);
  }
  const items = node.items;
  if (isSchemaNode(items)) toStructuredOutputSchema(items);
  else if (Array.isArray(items)) for (const child of items) if (isSchemaNode(child)) toStructuredOutputSchema(child);
  return node;
}

/** JSON-schema output format for a zod schema; null when the schema can't be represented. Cached per schema. */
export function outputFormatFor(schema: z.ZodType): JsonFormat | null {
  const cached = formatCache.get(schema);
  if (cached !== undefined) return cached;
  let format: JsonFormat | null;
  try {
    const json = toJSONSchema(schema, { target: 'draft-2020-12', reused: 'inline', unrepresentable: 'throw', io: 'output' });
    format = { type: 'json_schema', schema: toStructuredOutputSchema(json as JsonSchemaNode) };
  } catch {
    format = null; // e.g. dates / transforms with no JSON Schema form — fall back to prompt-only JSON
  }
  formatCache.set(schema, format);
  return format;
}
