import type { Element, Point, SolidLensSpec } from "../../../shared/document";
import { add, cross, direction, dot, mul, norm, sub } from "../../../shared/geometry";
import { getMaterial } from "./materials";

/** 口径（size）方向上光线可到达的最大 |y| 余量 */
export const APERTURE_EPS = 1e-3;
/** 求交时忽略的近端距离，避免光线在同一表面重复自交 */
export const RAY_EPS = 0.005;
/** 近切线入射角阈值（光线与法线夹角，度） */
export const GRAZING_ANGLE_DEG = 82;
/** 中心/边缘厚度允许的最小值（mm） */
export const MIN_THICKNESS = 0.5;

export type SolidSurface = "front" | "rear" | "wall";

export interface SolidHit {
  t: number;
  point: Point;
  normal: Point;
  surface: SolidSurface;
}

export interface SolidValidation {
  valid: boolean;
  reasons: string[];
  /** 边缘厚度（mm），无法计算时为 null */
  edgeThickness: number | null;
}

export function solidSpec(e: Element): SolidLensSpec {
  const lens = e.lens;
  return {
    model: lens?.model ?? "solid",
    material: lens?.material ?? "BK7",
    r1: lens?.r1 ?? 100,
    r2: lens?.r2 ?? -100,
    thickness: lens?.thickness ?? 12,
  };
}

export function isSolidLens(e: Element): boolean {
  return e.kind === "lens" && e.lens?.model === "solid";
}

/** 实体坐标系：光轴为局部 +x，口径方向为局部 +y */
export function frame(e: Element) {
  const axis = direction(e.angle - 90); // 局部 +x
  const tangent = direction(e.angle); // 局部 +y
  return { axis, tangent };
}

export function toLocal(e: Element, p: Point): Point {
  const v = sub(p, e);
  const { axis, tangent } = frame(e);
  return { x: dot(v, axis), y: dot(v, tangent) };
}

export function toWorld(e: Element, p: Point): Point {
  const { axis, tangent } = frame(e);
  return add(e, add(mul(axis, p.x), mul(tangent, p.y)));
}

/**
 * 球面矢高：返回局部坐标 x 处球面在局部 y 高度上的 x 坐标。
 * R = 0 退化为平面。
 */
export function sagX(R: number, vertexX: number, y: number): number | null {
  if (Math.abs(R) < 1e-6) return vertexX;
  const under = R * R - y * y;
  if (under < 0) return null;
  // x = vx + R - sign(R)*sqrt(R²-y²)，对 R 正负均成立
  return vertexX + R - Math.sign(R) * Math.sqrt(under);
}

/** 球面在局部点 (x,y) 处的局部法线（指向球心的反方向按 sign(R) 取外法线） */
function sphereLocalNormal(R: number, vertexX: number, x: number, y: number): Point {
  // 球心位于 (vx + R, 0)
  const outward = norm({ x: x - (vertexX + R), y });
  return outward;
}

/**
 * 由当前薄透镜焦距生成一组对称实体参数（透镜制造者公式反解）。
 * 仅用于切换时给出起点，不保证与薄透镜完全等价；
 * 若理论曲率会让边缘厚度低于安全值，则按口径放大曲率半径并放宽焦距。
 */
export function buildSolidSpec(focal: number, aperture = 180): SolidLensSpec {
  const material = "BK7";
  const n = getMaterial(material).nD;
  // 中心厚度随口径增长，保证大口径实体仍有正的边缘厚度
  const t = Math.min(40, Math.max(12, aperture * 0.08));
  const f = Math.abs(focal) >= 10 ? focal : 180;
  const power = 1 / f;
  // 对称双凸/双凹：R1 = R, R2 = -R
  // 1/f = (n-1)[1/R1 - 1/R2 + (1-n)t/(n R1 R2)]
  // 令 R2 = -R1 = -R：1/f = (n-1)[2/R + (n-1)t/(n R²)]
  const a = ((n - 1) * (n - 1) * t) / n; // 乘以 1/R²
  const b = 2 * (n - 1); // 乘以 1/R
  const c = -power;
  const disc = b * b - 4 * a * c;
  let R = 0;
  if (disc > 0) {
    const invR = (-b + Math.sqrt(disc)) / (2 * a);
    R = Math.abs(invR) > 1e-6 ? 1 / invR : 0;
  }
  if (!Number.isFinite(R) || Math.abs(R) < 20) R = f > 0 ? 120 : -120;
  // 曲率半径允许到 2000 mm：大口径浅曲面需要长半径才能保持正边缘厚度
  const R_LIMIT = 2000;
  // 保证对称双凸的边缘厚度 t - 2·sag(R) >= targetEdge mm（仅双凸 R>0 需要保护，
  // 双凹 R<0 时边缘天然更厚）。sag = R - sqrt(R²-half²)，
  // 由 sag <= maxSag 反解 R >= (half² + maxSag²)/(2·maxSag)。
  if (R > 0) {
    const half = aperture / 2;
    const targetEdge = 2;
    const maxSag = Math.max(0.5, (t - targetEdge) / 2);
    const rMin = (half * half + maxSag * maxSag) / (2 * maxSag);
    if (R < rMin) R = Math.min(R_LIMIT, rMin);
  }
  R = Math.max(-R_LIMIT, Math.min(R_LIMIT, R));
  return {
    model: "solid",
    material,
    r1: R,
    r2: -R,
    thickness: t,
  };
}

/**
 * 透镜制造者公式给出的近轴等效焦距（mm）。
 * 1/f = (n-1)[1/R1 - 1/R2 + (1-n)·t/(n·R1·R2)]，平面 R=0 项按 0 处理。
 */
export function effectiveFocalLength(e: Element): number | null {
  const s = solidSpec(e);
  const n = getMaterial(s.material).nD;
  const p1 = Math.abs(s.r1) > 1e-6 ? 1 / s.r1 : 0;
  const p2 = Math.abs(s.r2) > 1e-6 ? 1 / s.r2 : 0;
  let power = (n - 1) * (p1 - p2);
  if (Math.abs(s.r1) > 1e-6 && Math.abs(s.r2) > 1e-6) {
    power += (n - 1) * (((1 - n) * s.thickness) / (n * s.r1 * s.r2));
  }
  return Math.abs(power) > 1e-9 ? 1 / power : null;
}

/** 实体有效性检查：曲率必须覆盖口径，厚度为正，边缘不得自交。 */
export function validateSolid(e: Element): SolidValidation {
  const s = solidSpec(e);
  const half = e.size / 2;
  const reasons: string[] = [];
  let edgeThickness: number | null = null;

  if (!(s.thickness >= MIN_THICKNESS)) {
    reasons.push(`中心厚度 ${s.thickness.toFixed(1)} mm 小于最小值 ${MIN_THICKNESS} mm`);
  }
  for (const [label, R] of [
    ["前表面", s.r1],
    ["后表面", s.r2],
  ] as const) {
    if (R !== 0 && Math.abs(R) < half) {
      reasons.push(
        `${label}曲率半径 ${R.toFixed(0)} mm 无法覆盖口径半径 ${half.toFixed(0)} mm`,
      );
    }
  }
  const x1 = sagX(s.r1, 0, half);
  const x2 = sagX(s.r2, s.thickness, half);
  if (x1 !== null && x2 !== null) {
    edgeThickness = x2 - x1;
    if (edgeThickness < MIN_THICKNESS) {
      reasons.push(
        `边缘厚度仅 ${edgeThickness.toFixed(1)} mm，曲面在口径内自交或过薄`,
      );
    }
  }
  if (s.thickness <= 0) reasons.push("中心厚度必须为正数");
  return { valid: reasons.length === 0, reasons, edgeThickness };
}

function intersectSphere(
  o: Point,
  d: Point,
  R: number,
  vertexX: number,
  half: number,
): { t: number; point: Point; normal: Point } | null {
  if (Math.abs(R) < 1e-6) return null;
  // 球心 C = (vx + R, 0)，解 |o + td - C|² = R²
  const cx = vertexX + R;
  const ox = o.x - cx;
  const bq = ox * d.x + o.y * d.y;
  const cq = ox * ox + o.y * o.y - R * R;
  const disc = bq * bq - cq;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  for (const t of [ -bq - sq, -bq + sq ]) {
    if (t <= RAY_EPS) continue;
    const x = o.x + d.x * t;
    const y = o.y + d.y * t;
    if (Math.abs(y) > half + APERTURE_EPS) continue;
    // 确认落在该表面正确的矢高分片上（排除同一球面的另一支）
    const sag = sagX(R, vertexX, y);
    if (sag === null || Math.abs(x - sag) > 1e-4) continue;
    const n = sphereLocalNormal(R, vertexX, x, y);
    return { t, point: { x, y }, normal: n };
  }
  return null;
}

function intersectPlane(
  o: Point,
  d: Point,
  x: number,
  half: number,
  sign: 1 | -1,
): { t: number; point: Point; normal: Point } | null {
  if (Math.abs(d.x) < 1e-9) return null;
  const t = (x - o.x) / d.x;
  if (t <= RAY_EPS) return null;
  const y = o.y + d.y * t;
  if (Math.abs(y) > half + APERTURE_EPS) return null;
  return { t, point: { x, y }, normal: { x: sign, y: 0 } };
}

/** 侧壁：连接前后表面边缘点的线段（局部坐标），法线朝 ±y 外侧 */
function intersectWall(
  o: Point,
  d: Point,
  a: Point,
  b: Point,
  normalSign: 1 | -1,
): { t: number; point: Point; normal: Point } | null {
  const edge = sub(b, a);
  const den = cross(d, edge);
  if (Math.abs(den) < 1e-12) return null;
  const v = sub(a, o);
  const t = cross(v, edge) / den;
  const u = cross(v, d) / den;
  if (t <= RAY_EPS || u < 0 || u > 1) return null;
  return {
    t,
    point: add(o, mul(d, t)),
    normal: { x: 0, y: normalSign },
  };
}

/**
 * 实体透镜光线求交（局部坐标输入/输出）。
 * 区分前表面、后表面与侧壁，统一返回最近的有效交点与外法线。
 */
export function intersectSolid(
  e: Element,
  localOrigin: Point,
  localDir: Point,
  spec = solidSpec(e),
): SolidHit | null {
  const half = e.size / 2;
  const candidates: SolidHit[] = [];
  const pushSurface = (
    label: SolidSurface,
    hit: { t: number; point: Point; normal: Point } | null,
  ) => {
    if (hit) candidates.push({ ...hit, surface: label });
  };
  // 前表面顶点 x=0
  if (Math.abs(spec.r1) < 1e-6) {
    pushSurface("front", intersectPlane(localOrigin, localDir, 0, half, -1));
  } else {
    pushSurface(
      "front",
      intersectSphere(localOrigin, localDir, spec.r1, 0, half),
    );
  }
  // 后表面顶点 x=thickness
  if (Math.abs(spec.r2) < 1e-6) {
    pushSurface(
      "rear",
      intersectPlane(localOrigin, localDir, spec.thickness, half, 1),
    );
  } else {
    pushSurface(
      "rear",
      intersectSphere(localOrigin, localDir, spec.r2, spec.thickness, half),
    );
  }
  // 侧壁（上下两条）
  const yEdge = half;
  const fEdge = sagX(spec.r1, 0, yEdge) ?? 0;
  const rEdge = sagX(spec.r2, spec.thickness, yEdge) ?? spec.thickness;
  if (rEdge > fEdge) {
    pushSurface(
      "wall",
      intersectWall(
        localOrigin,
        localDir,
        { x: fEdge, y: yEdge },
        { x: rEdge, y: yEdge },
        1,
      ),
    );
    pushSurface(
      "wall",
      intersectWall(
        localOrigin,
        localDir,
        { x: rEdge, y: -yEdge },
        { x: fEdge, y: -yEdge },
        -1,
      ),
    );
  }
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (a.t < b.t ? a : b));
}

/** 实体轮廓采样点（局部坐标），用于绘制与重叠包围盒 */
export function solidOutline(e: Element, samples = 24): Point[] {
  const s = solidSpec(e);
  const half = e.size / 2;
  const top: Point[] = [];
  const bottom: Point[] = [];
  for (let i = 0; i <= samples; i++) {
    const y = -half + (2 * half * i) / samples;
    const x1 = sagX(s.r1, 0, y) ?? 0;
    const x2 = sagX(s.r2, s.thickness, y) ?? s.thickness;
    top.push({ x: x1, y });
    bottom.push({ x: x2, y });
  }
  // 前表面自下而上，后表面自上而下，构成闭合轮廓
  return [...top, ...bottom.reverse()];
}

/** 世界坐标包围盒 */
export function worldBounds(e: Element): { min: Point; max: Point } {
  const outline = isSolidLens(e)
    ? solidOutline(e, 12)
    : [
        { x: -2, y: -e.size / 2 },
        { x: 2, y: e.size / 2 },
      ];
  const pts = outline.map((p) => toWorld(e, p));
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    min: { x: Math.min(...xs), y: Math.min(...ys) },
    max: { x: Math.max(...xs), y: Math.max(...ys) },
  };
}

/** 两个透镜的世界包围盒是否显著重叠（容差避免边缘相切误报，拖动重叠检测） */
export function boundsOverlap(
  a: { min: Point; max: Point },
  b: { min: Point; max: Point },
): boolean {
  const tol = 2;
  // 投影区间相交长度超过容差才算重叠，相切/轻微擦过不警告
  const ox = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const oy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  return ox > tol && oy > tol;
}

/** 光线与法线夹角是否接近切线（度） */
export function isGrazing(d: Point, normal: Point): boolean {
  const cosA = Math.abs(dot(d, normal));
  return cosA < Math.cos((GRAZING_ANGLE_DEG * Math.PI) / 180);
}
