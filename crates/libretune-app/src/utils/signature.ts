export type MatchType = 'exact' | 'partial' | 'mismatch';

export function shouldBlockOnSignature(matchType: MatchType | null | undefined): boolean {
  return !!matchType && matchType !== 'exact';
}
