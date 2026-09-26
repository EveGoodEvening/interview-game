import type { TFunction } from '../../i18n';

const KNOWN_CODES = new Set([
  'config',
  'auth',
  'not_found',
  'rate_limit',
  'bad_request',
  'server',
  'network',
  'timeout',
  'aborted',
  'refusal',
  'truncated',
  'parse',
]);

/** Localized, friendly text for an LlmError code (falls back to a generic message). */
export function llmErrorText(t: TFunction, code: string | undefined): string {
  return code && KNOWN_CODES.has(code) ? t(`common.llmError.${code}`) : t('common.unknownError');
}
