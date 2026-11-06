import { seatCode } from '../../lib/booking/seats';
import { formatPaise } from '../../lib/format';
import { seatCategoryLabel, type PlacedSeat } from './seatLayout';
import type { EventPhoto } from './useEventPhoto';

/**
 * "View from seat" (1024px and up): the event's photo, scaled up for front rows and shifted by
 * the seat's horizontal offset, slightly blurred from the back. An approximation, and it says so.
 */
export function ViewFromSeat({ placed, totalRows, photo, onPhotoError }: { placed: PlacedSeat | null; totalRows: number; photo: EventPhoto | null; onPhotoError: () => void }) {
  if (!placed) return null;
  const { seat } = placed;
  const depth = totalRows > 1 ? placed.rowIndex / (totalRows - 1) : 0; // 0 front .. 1 back
  const scale = 1.55 - 0.5 * depth;
  // translateX is applied after scale, so this keeps the photo's edges out of the frame.
  const maxShift = ((scale - 1) / (2 * scale)) * 100 * 0.9;
  const shift = -Math.max(-1, Math.min(1, placed.dxNorm)) * maxShift;
  const blur = depth > 0.6 ? 0.6 : 0;
  const side = Math.abs(placed.dxNorm) < 0.2 ? 'centre' : placed.dxNorm < 0 ? 'left side' : 'right side';
  const code = seatCode(seat);
  return (
    <div className="bk-card bk-view">
      <div className="bk-view-frame">
        {photo && (
          <img
            src={photo.src}
            alt={`Approximate view of the stage from seat ${code}`}
            onError={onPhotoError}
            decoding="async"
            className="bk-view-img"
            style={{ transform: `scale(${scale.toFixed(2)}) translateX(${shift.toFixed(1)}%)`, filter: blur ? `blur(${blur}px)` : 'none' }}
          />
        )}
        <div aria-hidden="true" className="bk-view-shade" />
        <span className="bk-view-tag">VIEW FROM {code}</span>
        <span className="bk-view-cap">
          Row {seat.row}, {side} · approximate view
        </span>
      </div>
      <div className="bk-view-foot">
        <span>{seatCategoryLabel(seat.category)}</span>
        <span className="bk-strong">{formatPaise(seat.pricePaise)}</span>
      </div>
    </div>
  );
}
