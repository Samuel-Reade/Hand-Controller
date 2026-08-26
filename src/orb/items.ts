// The flat item list: every report placed on its orbit, with the local
// position precomputed once. Shared by the scene, the label layer and the
// frame loop.

import { ORBITS } from '../data/orbits'
import { itemLocalPosition, itemTheta } from './geometry'

export interface OrbItem {
  id: string
  title: string
  orbitIndex: number
  itemIndex: number
  phi: number
  theta: number
  local: readonly [number, number, number]
}

export const ORB_ITEMS: OrbItem[] = ORBITS.flatMap((orbit, orbitIndex) =>
  orbit.reports.map((report, itemIndex) => {
    const theta = itemTheta(itemIndex, orbit.reports.length)
    return {
      id: report.id,
      title: report.title,
      orbitIndex,
      itemIndex,
      phi: orbit.latitude,
      theta,
      local: itemLocalPosition(orbit.latitude, theta),
    }
  }),
)
