import type { Element, LabDocument, TraceResult } from "../../../shared/document";
import { add, direction, mul } from "../../../shared/geometry";
import { wavelengthColor } from "../lib/emission";

/**
 * 在接收屏上按真实命中位置绘制光斑：
 * 每条命中光线渲染为一个彩色光斑，亮度随功率叠加；
 * 近轴/边缘光线的位置差即可直观看出球差弥散。
 */
export function SpotLayer({
  doc,
  result,
}: {
  doc: LabDocument;
  result: TraceResult;
}) {
  const screens = doc.items.filter((e) => e.kind === "screen");
  return (
    <g pointerEvents="none">
      {screens.map((screen) => {
        const tangent = direction(screen.angle);
        const normal = direction(screen.angle - 90);
        return result.hits
          .filter((h) => h.screen === screen.id)
          .map((h, i) => {
            const center = add(
              add(screen, mul(tangent, h.position)),
              mul(normal, 4),
            );
            const r = 3.2;
            return (
              <circle
                key={`${screen.id}-${i}`}
                cx={center.x}
                cy={center.y}
                r={r}
                fill={wavelengthColor(h.wavelength)}
                opacity={Math.min(0.9, 0.25 + h.power * 2.2)}
              />
            );
          });
      })}
    </g>
  );
}
