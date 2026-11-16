import type { Element, Point, TraceWarning, WarningCode } from "../../../shared/document";
import {
  add,
  endpoints,
  intersect,
  mul,
  norm,
  prismVertices,
} from "../../../shared/geometry";
import {
  boundsOverlap,
  frame,
  intersectSolid,
  isSolidLens,
  toLocal,
  toWorld,
  validateSolid,
  worldBounds,
  type SolidSurface,
} from "./solidLens";

export interface SurfaceHit {
  element: Element;
  t: number;
  point: Point;
  normal: Point;
  /** 实体透镜命中的表面类型；其余器件为 undefined */
  surface?: SolidSurface;
}

export function nearestSurface(
  items: Element[],
  origin: Point,
  direction: Point,
  skipValidation = false,
): SurfaceHit | null {
  let best: SurfaceHit | null = null;
  const consider = (hit: SurfaceHit | null) => {
    if (hit && (!best || hit.t < best.t)) best = hit;
  };
  for (const e of items) {
    if (e.kind === "source") continue;
    if (isSolidLens(e)) {
      // 无效实体默认不参与求交；测试可通过 skipValidation 强制求交
      if (!skipValidation && !validateSolid(e).valid) continue;
      const { axis, tangent } = frame(e);
      const localO = toLocal(e, origin);
      const localD = {
        x: direction.x * axis.x + direction.y * axis.y,
        y: direction.x * tangent.x + direction.y * tangent.y,
      };
      const localHit = intersectSolid(e, localO, localD);
      if (!localHit) continue;
      // 局部基为正交单位向量，局部距离即世界距离
      consider({
        element: e,
        t: localHit.t,
        point: toWorld(e, localHit.point),
        normal: norm(
          add(mul(axis, localHit.normal.x), mul(tangent, localHit.normal.y)),
        ),
        surface: localHit.surface,
      });
      continue;
    }
    const vertices = e.kind === "prism" ? prismVertices(e) : endpoints(e);
    const edges =
      e.kind === "prism"
        ? vertices.map((v, i) => [v, vertices[(i + 1) % 3]])
        : [vertices];
    for (const [a, b] of edges) {
      const hit = intersect(origin, direction, a, b);
      if (hit) consider({ ...hit, element: e });
    }
  }
  return best;
}

/** 场景级警告：无效实体与透镜包围盒重叠，每路追迹前计算一次 */
export function sceneWarnings(items: Element[]): TraceWarning[] {
  const warnings: TraceWarning[] = [];
  const push = (code: WarningCode, elementId: string, message: string) => {
    const existing = warnings.find((w) => w.code === code && w.elementId === elementId);
    if (existing) existing.count++;
    else warnings.push({ code, elementId, message, count: 1 });
  };
  const lenses = items.filter((e) => e.kind === "lens");
  for (const lens of lenses) {
    if (isSolidLens(lens)) {
      const v = validateSolid(lens);
      if (!v.valid) {
        push("invalid-solid", lens.id, v.reasons[0]);
      }
    }
  }
  for (let i = 0; i < lenses.length; i++) {
    for (let j = i + 1; j < lenses.length; j++) {
      const a = lenses[i];
      const b = lenses[j];
      if (boundsOverlap(worldBounds(a), worldBounds(b))) {
        push("lens-overlap", a.id, "透镜轮廓重叠，最近表面求交结果可能不具物理意义");
      }
    }
  }
  return warnings;
}
