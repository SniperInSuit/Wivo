/**
 * OdontogramPicker — visual SVG dental arch, FDI notation
 * Teeth are arranged in upper and lower arches, click to select.
 * Selected → stored as comma-separated FDI numbers (e.g. "11,21,22")
 */

// ─── Arch geometry ────────────────────────────────────────────────────────────
const W = 460, H = 330
const CX = W / 2  // 230

// Upper arch: front teeth bottom at UCY+URY = 82+52 = 134
const UCX = CX, UCY = 82, URX = 180, URY = 52
// Lower arch: front teeth top at LCY-LRY = 248-52 = 196  → 62px gap at front
const LCX = CX, LCY = 248, LRX = 180, LRY = 52

// Teeth ordered from patient's right (i=0) to patient's left (i=15)
const UPPER_NUMS = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]
const LOWER_NUMS = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]

// Tooth size by FDI position from center (1=central incisor, 8=wisdom)
const TDIM: { w: number; h: number }[] = [
  { w: 0,  h: 0  }, // 0 unused
  { w: 14, h: 19 }, // 1 central incisor
  { w: 12, h: 17 }, // 2 lateral incisor
  { w: 12, h: 20 }, // 3 canine (tallest)
  { w: 14, h: 16 }, // 4 1st premolar
  { w: 13, h: 15 }, // 5 2nd premolar
  { w: 18, h: 14 }, // 6 1st molar
  { w: 18, h: 13 }, // 7 2nd molar
  { w: 15, h: 11 }, // 8 wisdom tooth
]

// FDI position from center (1–8)
function fdiPos(i: number) { return i < 8 ? (8 - i) : (i - 7) }

// Arch angle for tooth index i (0=right, 15=left), 0 → π
// Arcsin distribution gives even arc-length spacing instead of crowding wisdom teeth
function archTheta(i: number) { return Math.asin(2 * i / 15 - 1) + Math.PI / 2 }

// Gentle lean along the arch (degrees), reduced factor to avoid excess tilt
function toothRot(i: number) {
  return (archTheta(i) * 180 / Math.PI - 90) * 0.38
}

function upperXY(i: number) {
  const a = archTheta(i)
  return { x: UCX + URX * Math.cos(a), y: UCY + URY * Math.sin(a) }
}
function lowerXY(i: number) {
  const a = archTheta(i)
  return { x: LCX + LRX * Math.cos(a), y: LCY - LRY * Math.sin(a) }
}

// ─── SVG background paths ─────────────────────────────────────────────────────
// Upper gum band
const upperGum = [
  `M ${UCX - URX - 20} ${UCY}`,
  `A ${URX + 20} ${URY + 16} 0 0 1 ${UCX + URX + 20} ${UCY}`,
  `L ${UCX + URX + 20} ${UCY - 58}`,
  `L ${UCX - URX - 20} ${UCY - 58}`,
  `Z`
].join(' ')

// Lower gum band
const lowerGum = [
  `M ${LCX - LRX - 20} ${LCY}`,
  `A ${LRX + 20} ${LRY + 16} 0 0 0 ${LCX + LRX + 20} ${LCY}`,
  `L ${LCX + LRX + 20} ${LCY + 58}`,
  `L ${LCX - LRX - 20} ${LCY + 58}`,
  `Z`
].join(' ')

// ─── Component ────────────────────────────────────────────────────────────────
interface OdontogramPickerProps {
  value: string   // comma-separated FDI numbers, e.g. "11,21"
  onChange: (value: string) => void
  disabled?: boolean
}

export function OdontogramPicker({ value, onChange, disabled }: OdontogramPickerProps) {
  const selected = new Set(
    value.split(',').map(t => t.trim()).filter(Boolean)
  )

  function toggle(num: number) {
    if (disabled) return
    const s = String(num)
    const next = new Set(selected)
    next.has(s) ? next.delete(s) : next.add(s)
    onChange([...next].join(','))
  }

  function Tooth({
    num, cx, cy, upper
  }: { num: number; cx: number; cy: number; upper: boolean }) {
    const i = upper
      ? UPPER_NUMS.indexOf(num)
      : LOWER_NUMS.indexOf(num)
    const pos = fdiPos(i)
    const { w, h } = TDIM[pos]
    const rot = toothRot(i)
    const sel = selected.has(String(num))

    const fill   = sel ? '#0AB6C4' : '#FAFAFA'
    const stroke = sel ? '#088A96' : '#C8B4B6'

    // Upper teeth: rect extends downward from arch point; lower: upward
    const rectY = upper ? 0 : -h

    return (
      <g
        transform={`translate(${cx},${cy}) rotate(${rot})`}
        onClick={() => toggle(num)}
        style={{ cursor: disabled ? 'not-allowed' : 'pointer' }}
        opacity={disabled ? 0.6 : 1}
      >
        {/* Tooth body */}
        <rect
          x={-w / 2}
          y={rectY}
          width={w}
          height={h}
          rx={3}
          ry={3}
          fill={fill}
          stroke={stroke}
          strokeWidth={1.3}
        />
        {/* Bite-surface line (anterior teeth) */}
        {pos <= 5 && (
          <line
            x1={-w / 2 + 2}
            y1={upper ? h - 3 : rectY + 3}
            x2={w / 2 - 2}
            y2={upper ? h - 3 : rectY + 3}
            stroke={sel ? 'rgba(255,255,255,0.6)' : '#D8C8CA'}
            strokeWidth={0.8}
          />
        )}
        {/* Molar ridge lines */}
        {pos >= 6 && (
          <>
            <line x1={-2} y1={upper ? 2 : rectY + 2} x2={-2} y2={upper ? h - 2 : -2} stroke={sel ? 'rgba(255,255,255,0.5)' : '#E0CECE'} strokeWidth={0.8} />
            <line x1={2}  y1={upper ? 2 : rectY + 2} x2={2}  y2={upper ? h - 2 : -2} stroke={sel ? 'rgba(255,255,255,0.5)' : '#E0CECE'} strokeWidth={0.8} />
          </>
        )}
      </g>
    )
  }

  const count = selected.size

  return (
    <div className="space-y-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-xl"
        style={{ maxHeight: H, background: '#FFF5F6' }}
      >
        {/* ── Gum backgrounds ── */}
        <path d={upperGum} fill="#F5C4CA" />
        <path d={lowerGum} fill="#F5C4CA" />

        {/* Inner palate / mouth floor area */}
        <ellipse cx={UCX} cy={UCY} rx={URX - 10} ry={URY - 4} fill="#FDDFE1" />
        <ellipse cx={LCX} cy={LCY} rx={LRX - 10} ry={LRY - 4} fill="#FDDFE1" />

        {/* Gum edge highlight arcs */}
        <path
          d={`M ${UCX - URX - 4} ${UCY} A ${URX + 4} ${URY + 4} 0 0 1 ${UCX + URX + 4} ${UCY}`}
          fill="none" stroke="#EBA8B0" strokeWidth={3}
        />
        <path
          d={`M ${LCX - LRX - 4} ${LCY} A ${LRX + 4} ${LRY + 4} 0 0 0 ${LCX + LRX + 4} ${LCY}`}
          fill="none" stroke="#EBA8B0" strokeWidth={3}
        />

        {/* Midline */}
        <line
          x1={CX} y1={12} x2={CX} y2={H - 12}
          stroke="#DDB8BC" strokeWidth={1} strokeDasharray="3 3"
        />

        {/* R / L labels */}
        <text x={16}     y={H / 2 + 4} fontSize={10} fill="#C4989E" fontWeight="600" fontFamily="sans-serif">R</text>
        <text x={W - 16} y={H / 2 + 4} fontSize={10} fill="#C4989E" fontWeight="600" fontFamily="sans-serif" textAnchor="end">L</text>

        {/* ── Upper teeth ── */}
        {UPPER_NUMS.map((num, i) => {
          const { x, y } = upperXY(i)
          return <Tooth key={num} num={num} cx={x} cy={y} upper={true} />
        })}

        {/* ── Lower teeth ── */}
        {LOWER_NUMS.map((num, i) => {
          const { x, y } = lowerXY(i)
          return <Tooth key={num} num={num} cx={x} cy={y} upper={false} />
        })}

        {/* ── Upper FDI labels — fixed row above the gum ── */}
        {UPPER_NUMS.map((num, i) => {
          const { x } = upperXY(i)
          const sel = selected.has(String(num))
          return (
            <text
              key={`ul-${num}`}
              x={x} y={16}
              textAnchor="middle"
              fontSize={9.5}
              fontFamily="monospace"
              fontWeight="700"
              fill={sel ? '#0AB6C4' : '#A08088'}
              onClick={() => toggle(num)}
              style={{ cursor: disabled ? 'not-allowed' : 'pointer', userSelect: 'none' }}
            >
              {num}
            </text>
          )
        })}

        {/* ── Lower FDI labels — fixed row below the gum ── */}
        {LOWER_NUMS.map((num, i) => {
          const { x } = lowerXY(i)
          const sel = selected.has(String(num))
          return (
            <text
              key={`ll-${num}`}
              x={x} y={322}
              textAnchor="middle"
              fontSize={9.5}
              fontFamily="monospace"
              fontWeight="700"
              fill={sel ? '#0AB6C4' : '#A08088'}
              onClick={() => toggle(num)}
              style={{ cursor: disabled ? 'not-allowed' : 'pointer', userSelect: 'none' }}
            >
              {num}
            </text>
          )
        })}
      </svg>

      {/* Selection summary */}
      <div className="flex items-center justify-between">
        {count > 0 ? (
          <p className="text-xs text-accent font-semibold">
            {count} hammas{count !== 1 ? 't' : ''} valitud: {[...selected].join(', ')}
          </p>
        ) : (
          <p className="text-xs text-ink-faint">Vali hambad klõpsates</p>
        )}
        {count > 0 && (
          <button
            type="button"
            onClick={() => onChange('')}
            disabled={disabled}
            className="text-xs text-ink-muted hover:text-red-500 transition-colors"
          >
            Tühjenda
          </button>
        )}
      </div>
    </div>
  )
}
