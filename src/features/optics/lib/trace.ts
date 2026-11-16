import type {
  LabDocument,
  TraceResult,
  TraceWarning,
  WarningCode,
} from "../../../shared/document";
import { add, mul, dot, sub, direction, norm } from "../../../shared/geometry";
import { emit } from "./emission";
import { nearestSurface, sceneWarnings } from "./surfaces";
import { reflect, refract, materialIndex } from "./refraction";
import { glassIndex } from "./materials";
import { isGrazing, isSolidLens, solidSpec } from "./solidLens";

const MAX_WARNING_COUNT = 99;

export function trace(doc: LabDocument): TraceResult {
  const result: TraceResult = {
    segments: [],
    hits: [],
    truncated: 0,
    warnings: sceneWarnings(doc.items),
  };
  const pushWarning = (
    code: WarningCode,
    elementId: string | undefined,
    message: string,
  ) => {
    const existing = result.warnings.find(
      (w) => w.code === code && w.elementId === elementId,
    );
    if (existing) {
      existing.count = Math.min(MAX_WARNING_COUNT, existing.count + 1);
    } else {
      result.warnings.push({ code, elementId, message, count: 1 });
    }
  };

  for (const source of doc.items.filter((e) => e.kind === "source"))
    for (const ray of emit(source)) {
      let o = ray.origin,
        d = ray.direction,
        inside: string | null = null,
        power = ray.power;
      for (let bounce = 0; bounce < 32; bounce++) {
        const hit = nearestSurface(doc.items, o, d);
        const dest = hit?.point ?? add(o, mul(d, 1800));
        result.segments.push({
          from: o,
          to: dest,
          power,
          wavelength: source.wavelength,
          source: source.id,
        });
        if (!hit) break;
        const e = hit.element;
        if (e.kind === "screen") {
          result.hits.push({
            screen: e.id,
            position: dot(sub(hit.point, e), direction(e.angle)),
            power,
            wavelength: source.wavelength,
            source: source.id,
            aperture: ray.aperture,
          });
          break;
        }
        if (e.kind === "mirror") d = reflect(d, hit.normal);
        if (e.kind === "lens" && !isSolidLens(e)) {
          // 近轴薄透镜模型：保持原规则不变，边缘光线同样按焦距偏折
          const axis = direction(e.angle - 90),
            tangent = direction(e.angle),
            forward = dot(d, axis) >= 0 ? 1 : -1,
            u = dot(sub(hit.point, e), tangent),
            axial = Math.max(0.0001, Math.abs(dot(d, axis))),
            slope = dot(d, tangent) / axial - u / e.focal;
          d = norm(add(mul(axis, forward), mul(tangent, slope)));
        }
        if (e.kind === "lens" && isSolidLens(e)) {
          const spec = solidSpec(e);
          if (hit.surface === "wall") {
            // 侧壁按毛面/反射面处理，光线不会从圆柱侧壁穿出玻璃
            d = reflect(d, hit.normal);
            power *= 0.96;
            pushWarning(
              "wall-hit",
              e.id,
              "光线命中透镜侧壁并被反射，未参与前后表面成像",
            );
          } else {
            const n = glassIndex(spec.material, source.wavelength);
            const exiting: boolean = inside === e.id;
            if (isGrazing(d, hit.normal)) {
              pushWarning(
                "grazing",
                e.id,
                "光线接近切线入射，折射结果对曲面精度敏感",
              );
            }
            const transmitted = refract(
              d,
              hit.normal,
              exiting ? n : 1,
              exiting ? 1 : n,
            );
            if (transmitted) {
              d = transmitted;
              inside = exiting ? null : e.id;
              power *= 0.96;
            } else {
              // 全内反射：光线留在玻璃内继续追迹，绝不强制穿出
              d = reflect(d, hit.normal);
              inside = e.id;
              pushWarning(
                "tir",
                e.id,
                "发生全内反射，光线保留在玻璃内部继续传播",
              );
            }
          }
        }
        if (e.kind === "prism") {
          const n = materialIndex(e.index, source.wavelength);
          const exiting: boolean = inside === e.id;
          const transmitted = refract(
            d,
            hit.normal,
            exiting ? n : 1,
            exiting ? 1 : n,
          );
          if (transmitted) {
            d = transmitted;
            inside = exiting ? null : e.id;
            power *= 0.96;
          } else d = reflect(d, hit.normal);
        }
        o = add(hit.point, mul(d, 0.01));
        if (bounce === 31) result.truncated++;
      }
    }
  return result;
}
