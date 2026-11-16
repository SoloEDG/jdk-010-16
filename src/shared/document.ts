export type Kind = "source" | "mirror" | "lens" | "prism" | "screen";
export interface Point {
  x: number;
  y: number;
}
/** 透镜物理模型：thin = 近轴薄透镜（原模型），solid = 带曲率/厚度/材料的实体透镜 */
export type LensModel = "thin" | "solid";
/**
 * 实体透镜参数（局部坐标系：光轴指向 +x，光线默认由前表面向后传播）。
 * 曲率半径采用透镜制造者符号约定：
 * r1 > 0 前表面外凸，r1 < 0 前表面内凹，0 表示平面；
 * r2 < 0 后表面外凸，r2 > 0 后表面内凹，0 表示平面。
 * thickness 为中心厚度（两表面顶点间距）。
 */
export interface SolidLensSpec {
  model: LensModel;
  material: string;
  r1: number;
  r2: number;
  thickness: number;
}
export interface Element extends Point {
  id: string;
  kind: Kind;
  angle: number;
  size: number;
  power: number;
  rays: number;
  spread: number;
  wavelength: number;
  focal: number;
  index: number;
  lens?: SolidLensSpec;
}
export interface LabDocument {
  version: 1;
  items: Element[];
}
export interface Segment {
  from: Point;
  to: Point;
  power: number;
  wavelength: number;
  source: string;
}
export interface ScreenHit {
  screen: string;
  position: number;
  power: number;
  wavelength: number;
  source: string;
  /** 发出该光线时相对光源中心的横向距离，用于区分近轴/边缘光线 */
  aperture?: number;
}
export type WarningCode =
  | "invalid-solid"
  | "lens-overlap"
  | "grazing"
  | "tir"
  | "wall-hit";
export interface TraceWarning {
  code: WarningCode;
  elementId?: string;
  message: string;
  count: number;
}
export interface TraceResult {
  segments: Segment[];
  hits: ScreenHit[];
  truncated: number;
  warnings: TraceWarning[];
}
export const labels: Record<Kind, string> = {
  source: "光源",
  mirror: "平面镜",
  lens: "凸透镜",
  prism: "三棱镜",
  screen: "接收屏",
};
export const warningLabels: Record<WarningCode, string> = {
  "invalid-solid": "无效实体",
  "lens-overlap": "透镜重叠",
  grazing: "近切线入射",
  tir: "全反射",
  "wall-hit": "侧壁反射",
};
