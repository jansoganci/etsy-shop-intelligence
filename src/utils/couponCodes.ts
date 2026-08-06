const COUPON_HASH_PATTERN = /^[A-F0-9]{16,}$/i;
const COUPON_DETAILS_SUFFIX_PATTERN = /\s+-\s+.+$/;

export function parseCouponCodeList(couponCode: string | null | undefined): string[] {
  if (!couponCode?.trim()) {
    return [];
  }

  const uniqueCodes = new Set<string>();

  for (const part of couponCode.split(";")) {
    const trimmed = part.trim();
    if (trimmed) {
      uniqueCodes.add(trimmed);
    }
  }

  return Array.from(uniqueCodes);
}

export function isCouponHash(value: string): boolean {
  return COUPON_HASH_PATTERN.test(value);
}

export function extractCouponDetailsLabel(couponDetails: string | null | undefined): string | null {
  if (!couponDetails?.trim()) {
    return null;
  }

  const trimmed = couponDetails.trim();
  const withoutSuffix = trimmed.replace(COUPON_DETAILS_SUFFIX_PATTERN, "").trim();

  if (!withoutSuffix || isCouponHash(withoutSuffix)) {
    return null;
  }

  return withoutSuffix;
}

export function shortenCouponHash(value: string): string {
  if (value.length <= 12) {
    return value;
  }

  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

export function resolveCouponLabels(
  couponCode: string | null | undefined,
  couponDetails: string | null | undefined,
): string[] {
  const codes = parseCouponCodeList(couponCode);

  if (codes.length === 0) {
    return [];
  }

  const detailsLabel = extractCouponDetailsLabel(couponDetails);

  if (codes.length === 1) {
    const [code] = codes;

    if (!isCouponHash(code)) {
      return [code];
    }

    return [detailsLabel ?? shortenCouponHash(code)];
  }

  return codes.map((code) => {
    if (!isCouponHash(code)) {
      return code;
    }

    return shortenCouponHash(code);
  });
}

export function buildCouponTooltip(
  couponCode: string | null | undefined,
  couponDetails: string | null | undefined,
  labels: string[],
): string | undefined {
  const parts: string[] = [];

  if (couponCode?.trim()) {
    parts.push(`Codes: ${couponCode.trim()}`);
  }

  if (couponDetails?.trim()) {
    parts.push(`Details: ${couponDetails.trim()}`);
  }

  if (parts.length === 0 && labels.length > 0) {
    return labels.join(", ");
  }

  return parts.length > 0 ? parts.join("\n") : undefined;
}
