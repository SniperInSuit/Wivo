// VITA Classical shade system with approximate display colors
export interface VitaShade {
  code: string
  group: 'A' | 'B' | 'C' | 'D'
  hex: string  // approximate tooth color for the swatch chip
}

export const VITA_SHADES: VitaShade[] = [
  // A group — reddish-brown
  { code: 'A1', group: 'A', hex: '#F5E6C8' },
  { code: 'A2', group: 'A', hex: '#F0DDB5' },
  { code: 'A2.5', group: 'A', hex: '#ECD4AB' },
  { code: 'A3', group: 'A', hex: '#E8CFA0' },
  { code: 'A3.5', group: 'A', hex: '#E0C090' },
  { code: 'A4', group: 'A', hex: '#D4AE78' },
  // B group — yellowish
  { code: 'B1', group: 'B', hex: '#F6EDD0' },
  { code: 'B2', group: 'B', hex: '#F0E3BE' },
  { code: 'B3', group: 'B', hex: '#E8D4A8' },
  { code: 'B4', group: 'B', hex: '#DEC490' },
  // C group — grayish
  { code: 'C1', group: 'C', hex: '#EDDFCA' },
  { code: 'C2', group: 'C', hex: '#E4D3B8' },
  { code: 'C3', group: 'C', hex: '#D8C4A4' },
  { code: 'C4', group: 'C', hex: '#CABB96' },
  // D group — reddish-gray
  { code: 'D2', group: 'D', hex: '#EAD8C0' },
  { code: 'D3', group: 'D', hex: '#DFCDB0' },
  { code: 'D4', group: 'D', hex: '#D4BEA0' }
]

export const VITA_GROUPS = ['A', 'B', 'C', 'D'] as const
