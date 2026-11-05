import { cn } from '../../lib/cn';
import { useFitScale, usePlayWhenVisible } from './hooks';

// Illustrative demo, exactly as in the design: Asha takes D7, Rahul reaches for it a moment
// too late, gets the "D7 was just taken. Try D9?" toast and takes D9. No API calls.
const ROWS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const SEATS = 16;
/** The race is drawn at this width; the cursor keyframes use absolute pixel positions. */
const RACE_WIDTH = 396;
/** 7 rows of 18px + 6 gaps of 6px. */
const RACE_HEIGHT = 162;

function seatClass(r: number, s: number): string {
  if (r === 3 && s === 7) return 'lp-hs lp-r7';
  if (r === 3 && s === 9) return 'lp-hs lp-r9';
  const taken = (r < 2 && s % 4 !== 1) || (r * 3 + s * 5) % 7 === 0;
  return taken ? 'lp-hs lp-hs-t' : 'lp-hs';
}

function Cursor({ who, name, fill }: { who: 'a' | 'r'; name: string; fill: string }) {
  return (
    <div className={cn('lp-cur', who === 'a' ? 'lp-cur-a' : 'lp-cur-r')}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 2l16 9-7 2-3 7z" fill={fill} stroke="#08080A" strokeWidth="1.5" />
      </svg>
      <span className="lp-cur-name" style={{ background: fill }}>
        {name}
      </span>
    </div>
  );
}

/** The hero's tilted, floating browser frame with the Asha/Rahul seat race. */
export function SeatRace() {
  const { ref: playRef, playing } = usePlayWhenVisible<HTMLDivElement>();
  const { ref: fitRef, scale } = useFitScale<HTMLDivElement>(RACE_WIDTH);

  return (
    <div ref={playRef} className={cn('lp-tilt', !playing && 'lp-paused')}>
      <div className="lp-float lp-frame">
        <div className="lp-frame-bar">
          <i />
          <i />
          <i />
          <span className="lp-frame-url">flashseat.app/shows/last-train</span>
        </div>
        <div className="lp-frame-body">
          <div className="lp-frame-head">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              <span className="lp-kicker">THEATRE · SAT 14 NOV · 7:30 PM</span>
              <span style={{ fontSize: 19, fontWeight: 600, letterSpacing: '-0.02em' }}>The Last Train to Lonavala</span>
            </div>
            <span className="lp-mono" style={{ fontSize: 10, color: 'var(--lp-muted)', whiteSpace: 'nowrap' }}>
              RANGDEEP, PUNE
            </span>
          </div>
          <div className="lp-stage" style={{ margin: '10px 48px 0' }} />
          <span className="lp-stage-label">STAGE</span>
          <div ref={fitRef} className="lp-race-fit" style={scale < 1 ? { height: RACE_HEIGHT * scale } : undefined}>
            <div aria-hidden="true" className="lp-race" style={scale < 1 ? { transform: `scale(${scale})` } : undefined}>
              {ROWS.map((label, r) => (
                <div key={label} className="lp-race-row">
                  <span className="lp-row-label">{label}</span>
                  {Array.from({ length: SEATS }, (_, i) => i + 1).map((s) => (
                    <span key={s} className={seatClass(r, s)} style={s === 9 ? { marginLeft: 14 } : undefined} />
                  ))}
                </div>
              ))}
              <Cursor who="a" name="Asha" fill="#FF6B4A" />
              <Cursor who="r" name="Rahul" fill="#E4E4E7" />
            </div>
          </div>
          {/* Decorative: a looping demo, so it is not announced as a live status. */}
          <div className="lp-toast lp-toast-anim" aria-hidden="true">
            <i className="lp-dot" />
            <span>
              D7 was just taken. <span style={{ color: 'var(--lp-text)', textDecoration: 'underline' }}>Try D9?</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
