import { useMemo } from "react";
import { Badge } from "../../../components/ui";
import {
  buildCouponTooltip,
  resolveCouponLabels,
} from "../../../utils/couponCodes";

type CouponCodeChipsProps = {
  couponCode: string | null | undefined;
  couponDetails?: string | null | undefined;
  maxVisible?: number;
};

export function CouponCodeChips({
  couponCode,
  couponDetails,
  maxVisible = 2,
}: CouponCodeChipsProps) {
  const labels = useMemo(
    () => resolveCouponLabels(couponCode, couponDetails),
    [couponCode, couponDetails],
  );

  const tooltip = useMemo(
    () => buildCouponTooltip(couponCode, couponDetails, labels),
    [couponCode, couponDetails, labels],
  );

  if (labels.length === 0) {
    return <span className="report-coupon-chips__empty">—</span>;
  }

  const visibleLabels = labels.slice(0, maxVisible);
  const hiddenCount = labels.length - visibleLabels.length;

  return (
    <div className="report-coupon-chips" title={tooltip}>
      {visibleLabels.map((label, index) => (
        <Badge key={`${label}-${index}`} size="sm" variant="accent">
          {label}
        </Badge>
      ))}
      {hiddenCount > 0 ? (
        <Badge size="sm" variant="neutral">
          +{hiddenCount} more
        </Badge>
      ) : null}
    </div>
  );
}
