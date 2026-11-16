import type { Element, ScreenHit } from "../../../shared/document";
export interface Measurement {
  bins: number[];
  energy: number;
  centroid: number;
  spread: number;
  count: number;
  peak: number;
  /** 横向球差：边缘 1/3 光线与近轴 1/3 光线平均落点之差（mm） */
  sphericalAberration: number;
  /** 95% 能量包围半径（mm） */
  e95: number;
}
export function measure(
  screen: Element | undefined,
  hits: ScreenHit[],
  resolution: number,
): Measurement {
  const valid = screen ? hits.filter((h) => h.screen === screen.id) : [];
  const bins = Array<number>(resolution).fill(0);
  let energy = 0,
    centroid = 0;
  for (const h of valid) {
    const i = Math.max(
      0,
      Math.min(
        resolution - 1,
        Math.floor((h.position / screen!.size + 0.5) * resolution),
      ),
    );
    bins[i] += h.power;
    energy += h.power;
    centroid += h.position * h.power;
  }
  centroid = energy ? centroid / energy : 0;
  const spread = energy
    ? Math.sqrt(
        valid.reduce((s, h) => s + (h.position - centroid) ** 2 * h.power, 0) /
          energy,
      )
    : 0;

  // 横向球差：按光线孔径绝对值分三组，比较边缘组与近轴组的平均落点
  let sphericalAberration = 0;
  if (valid.length >= 6 && valid.some((h) => h.aperture !== undefined)) {
    const withAperture = valid
      .filter((h) => h.aperture !== undefined)
      .sort((a, b) => Math.abs(a.aperture!) - Math.abs(b.aperture!));
    const third = Math.max(1, Math.floor(withAperture.length / 3));
    const inner = withAperture.slice(0, third);
    const outer = withAperture.slice(-third);
    const avg = (list: ScreenHit[]) =>
      list.reduce((s, h) => s + h.position * h.power, 0) /
      Math.max(
        1e-9,
        list.reduce((s, h) => s + h.power, 0),
      );
    sphericalAberration = avg(outer) - avg(inner);
  }

  // E95：按到质心距离排序，累计 95% 能量时的半径
  let e95 = 0;
  if (energy > 0) {
    const sorted = [...valid].sort(
      (a, b) => Math.abs(a.position - centroid) - Math.abs(b.position - centroid),
    );
    let acc = 0;
    for (const h of sorted) {
      acc += h.power;
      e95 = Math.abs(h.position - centroid);
      if (acc >= 0.95 * energy) break;
    }
  }

  return {
    bins,
    energy,
    centroid,
    spread,
    count: valid.length,
    peak: Math.max(0, ...bins),
    sphericalAberration,
    e95,
  };
}
