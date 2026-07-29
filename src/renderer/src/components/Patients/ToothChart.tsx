/**
 * ToothChart — 4-state FDI odontogram on straight rows.
 *
 * Deliberately NOT the arch geometry of JobDetail/OdontogramPicker: that chart
 * places #18 at x=410 (the viewer's right) while drawing the "R" label at x=16,
 * so the label contradicts the placement. Here x = PAD + i*PITCH with #18 at
 * i=0, which puts quadrants 1/4 on the left — where the "R" is. What is reused
 * from that file is the per-tooth detailing and the flat FDI label row.
 *
 * This chart only renders; it never resolves derived-vs-manual status. That is
 * ToothStatusPanel's job.
 */

import type { ToothStatus } from '../../types/teeth'
import {
  FDI_UPPER, FDI_LOWER, fdiPos, TDIM, TOOTH_STATE_MAP,
  CHART_W, CHART_H, PITCH, PAD, Y_UPPER, Y_LOWER,
  Y_LABEL_UPPER, Y_LABEL_LOWER, MIDLINE_X
} from '../../config/teeth'
import type { ToothStateStyle } from '../../config/teeth'

interface ToothChartProps {
  statuses: Record<number, ToothStatus>   // resolved 4-state map, all 32 keys present
  manualFdi?: Set<number>                 // which of those came from patient_teeth
  editable?: boolean
  onToothClick?: (fdi: number) => void
}

// A caller with a hole in its map still gets a tooth, not a crash
const styleFor = (statuses: Record<number, ToothStatus>, fdi: number): ToothStateStyle =>
  TOOTH_STATE_MAP[statuses[fdi] ?? 'terve']

const xFor = (i: number) => PAD + i * PITCH

interface ToothProps {
  fdi: number
  x: number
  upper: boolean
  style: ToothStateStyle
  manual: boolean
  editable: boolean
  onClick?: (fdi: number) => void
}

// Module scope on purpose. Nesting this inside the chart body — as
// OdontogramPicker.tsx:93 does — hands React a brand new component type on
// every render, which re-mounts all 32 teeth on every single click.
function Tooth({ fdi, x, upper, style, manual, editable, onClick }: ToothProps) {
  const pos = fdiPos(fdi)
  const { w, h } = TDIM[pos]
  const rectY = upper ? 0 : -h

  // Detail lines have to read against the tooth's own fill: white on the solid
  // teal 'toodeldud' body, the state's own stroke on the pale ones.
  const detailStroke = style.key === 'toodeldud' ? 'rgba(255,255,255,0.65)' : style.stroke
  const detailOpacity = style.key === 'toodeldud' ? 1 : 0.45

  // Column-wide invisible hit area — a wisdom tooth is only 15×11, too small to
  // click reliably and too small to hover for the tooltip. Width is exactly
  // PITCH so neighbouring columns tile without overlapping.
  const hitY = upper ? -16 : -h - 6
  const hitH = h + (upper ? 22 : 26)

  return (
    <g
      transform={`translate(${x},${upper ? Y_UPPER : Y_LOWER})`}
      onClick={editable && onClick ? () => onClick(fdi) : undefined}
      style={{ cursor: editable ? 'pointer' : 'default' }}
    >
      {/* Native tooltip — the app has no tooltip component. The suffix is what
          lets the user tell a derived 'Töödeldud' from a manual override, which
          silently wins over it (risk R13). */}
      <title>{`${fdi} — ${style.label}${manual ? ' — käsitsi määratud' : ''}`}</title>

      <rect x={-PITCH / 2} y={hitY} width={PITCH} height={hitH} fill="transparent" />

      {/* Tooth body */}
      <rect
        x={-w / 2}
        y={rectY}
        width={w}
        height={h}
        rx={3}
        ry={3}
        fill={style.fill}
        stroke={style.stroke}
        strokeWidth={style.strokeWidth}
        strokeDasharray={style.dash}
        opacity={style.opacity}
      />

      {/* Bite-surface line (anterior teeth) — always on the occlusal edge, so
          the bottom of an upper tooth and the top of a lower one */}
      {style.detail && pos <= 5 && (
        <line
          x1={-w / 2 + 2}
          y1={upper ? h - 3 : rectY + 3}
          x2={w / 2 - 2}
          y2={upper ? h - 3 : rectY + 3}
          stroke={detailStroke}
          strokeOpacity={detailOpacity}
          strokeWidth={0.8}
        />
      )}

      {/* Molar ridges */}
      {style.detail && pos >= 6 && (
        <>
          <line
            x1={-2} y1={upper ? 2 : rectY + 2}
            x2={-2} y2={upper ? h - 2 : -2}
            stroke={detailStroke} strokeOpacity={detailOpacity} strokeWidth={0.8}
          />
          <line
            x1={2} y1={upper ? 2 : rectY + 2}
            x2={2} y2={upper ? h - 2 : -2}
            stroke={detailStroke} strokeOpacity={detailOpacity} strokeWidth={0.8}
          />
        </>
      )}
    </g>
  )
}

export function ToothChart({ statuses, manualFdi, editable = false, onToothClick }: ToothChartProps) {
  return (
    <div className="bg-bg-sidebar rounded-xl p-3">
      <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} className="w-full rounded-xl" style={{ maxHeight: CHART_H }}>
        {/* Occlusal guide — the gap the two arches bite into */}
        <line
          x1={20} y1={62} x2={CHART_W - 20} y2={62}
          stroke="#A8B4BE" strokeOpacity={0.2} strokeWidth={1}
        />
        {/* Midline, between i=7 (x=217) and i=8 (x=243) */}
        <line
          x1={MIDLINE_X} y1={6} x2={MIDLINE_X} y2={CHART_H - 6}
          stroke="#A8B4BE" strokeOpacity={0.25} strokeWidth={1} strokeDasharray="3 3"
        />

        {/* Left = the patient's RIGHT — which is finally where quadrants 1/4 are drawn */}
        <text x={14} y={66} fontSize={10} fontWeight="600" fontFamily="sans-serif" fill="#A8B4BE">R</text>
        <text x={CHART_W - 14} y={66} textAnchor="end" fontSize={10} fontWeight="600" fontFamily="sans-serif" fill="#A8B4BE">L</text>

        {/* ── Upper arch ── */}
        {FDI_UPPER.map((fdi, i) => (
          <Tooth
            key={fdi}
            fdi={fdi}
            x={xFor(i)}
            upper={true}
            style={styleFor(statuses, fdi)}
            manual={manualFdi?.has(fdi) ?? false}
            editable={editable}
            onClick={onToothClick}
          />
        ))}

        {/* ── Lower arch ── */}
        {FDI_LOWER.map((fdi, i) => (
          <Tooth
            key={fdi}
            fdi={fdi}
            x={xFor(i)}
            upper={false}
            style={styleFor(statuses, fdi)}
            manual={manualFdi?.has(fdi) ?? false}
            editable={editable}
            onClick={onToothClick}
          />
        ))}

        {/* ── FDI label rows — flat, at a constant y, never rotated with the tooth.
               pointerEvents off so the label never eats its own tooth's tooltip. ── */}
        {FDI_UPPER.map((fdi, i) => (
          <text
            key={`ul-${fdi}`}
            x={xFor(i)} y={Y_LABEL_UPPER}
            textAnchor="middle" fontSize={9.5} fontFamily="monospace" fontWeight="700"
            fill={styleFor(statuses, fdi).labelFill}
            pointerEvents="none"
            style={{ userSelect: 'none' }}
          >
            {fdi}
          </text>
        ))}
        {FDI_LOWER.map((fdi, i) => (
          <text
            key={`ll-${fdi}`}
            x={xFor(i)} y={Y_LABEL_LOWER}
            textAnchor="middle" fontSize={9.5} fontFamily="monospace" fontWeight="700"
            fill={styleFor(statuses, fdi).labelFill}
            pointerEvents="none"
            style={{ userSelect: 'none' }}
          >
            {fdi}
          </text>
        ))}
      </svg>
    </div>
  )
}
