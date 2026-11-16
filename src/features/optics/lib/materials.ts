/**
 * 色散玻璃目录。
 * 采用简化 Cauchy 近似 n(λ) = nD + B * ((λD/λ)^2 - 1)，
 * 其中 B = (nD - 1) / Vd，使 F-d-C 主色散差与阿贝数一致。
 * 这是教学级色散模型，不替代完整 Sellmeier 多项式。
 */
export interface GlassMaterial {
  id: string;
  name: string;
  /** 氦 d 线 587.6 nm 处折射率 */
  nD: number;
  /** 阿贝数，越小色散越强 */
  vd: number;
}
export const MATERIAL_WAVELENGTH_D = 587.6;
export const glassCatalog: GlassMaterial[] = [
  { id: "BK7", name: "BK7 冕牌玻璃", nD: 1.5168, vd: 64.17 },
  { id: "B270", name: "B270 钠钙玻璃", nD: 1.523, vd: 58.5 },
  { id: "F2", name: "F2 火石玻璃", nD: 1.62, vd: 36.37 },
  { id: "SF11", name: "SF11 重火石玻璃", nD: 1.7847, vd: 25.68 },
];
export function getMaterial(id: string): GlassMaterial {
  return glassCatalog.find((g) => g.id === id) ?? glassCatalog[0];
}
/**
 * 波长相关折射率。wavelength 单位 nm。
 * 与原棱镜 materialIndex(base, λ) 的数量级保持一致（约 ±0.004）。
 */
export function glassIndex(material: string, wavelength: number): number {
  const g = getMaterial(material);
  const b = (g.nD - 1) / g.vd;
  return g.nD + b * ((MATERIAL_WAVELENGTH_D / wavelength) ** 2 - 1);
}
