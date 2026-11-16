import { Trash2, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { labels, type Element, type SolidLensSpec } from "../../../shared/document";
import { parameters, solidParameters, solidSummary } from "../lib/parameters";
import { buildSolidSpec } from "../../optics/lib/solidLens";
export function Inspector({
  element,
  onUpdate,
  onRemove,
}: {
  element?: Element;
  onUpdate: (patch: Partial<Element>) => void;
  onRemove: () => void;
}) {
  if (!element)
    return (
      <section className="inspector">
        <div className="section-title">
          器件属性 <SlidersHorizontal size={15} />
        </div>
        <p className="empty">
          选择实验台上的器件
          <br />
          查看并调整光学参数
        </p>
      </section>
    );
  const isLens = element.kind === "lens";
  const isSolid = element.lens?.model === "solid";
  const summary = isLens && isSolid ? solidSummary(element) : null;
  const patchLens = (p: Partial<SolidLensSpec>) =>
    onUpdate({ lens: { ...summary!.spec, ...p } });
  return (
    <section className="inspector">
      <div className="section-title">
        器件属性 <SlidersHorizontal size={15} />
      </div>
      <div className="selected-name">
        <i />
        {labels[element.kind]}
        <span>已选中</span>
      </div>
      {isLens && (
        <div className="model-switch" role="group" aria-label="透镜模型">
          <button
            className={!isSolid ? "active" : ""}
            onClick={() =>
              onUpdate({
                lens: undefined,
              })
            }
          >
            近轴薄透镜
          </button>
          <button
            className={isSolid ? "active" : ""}
            onClick={() =>
              onUpdate({
                lens: element.lens?.model
                  ? element.lens
                  : buildSolidSpec(element.focal, element.size),
              })
            }
          >
            实体透镜
          </button>
        </div>
      )}
      {isLens && (
        <p className="model-note">
          {isSolid
            ? "实体模型按球面 Snell 折射逐面追迹，含厚度与色散；与薄透镜参数不一一等价。"
            : "薄透镜为近轴理想化模型，边缘光线同样按焦距偏折，不模拟球差与厚度。"}
        </p>
      )}
      <div className="coordinates">
        {(["x", "y"] as const).map((key) => (
          <label key={key}>
            {key.toUpperCase()}
            <input
              aria-label={key + " 坐标"}
              type="number"
              min="20"
              max={key === "x" ? 980 : 580}
              value={Math.round(element[key])}
              onChange={(e) =>
                onUpdate({
                  [key]: Math.max(
                    20,
                    Math.min(key === "x" ? 980 : 580, Number(e.target.value)),
                  ),
                })
              }
            />
            <small>mm</small>
          </label>
        ))}
      </div>
      {summary && (
        <>
          <label className="parameter material-row">
            <span>
              色散材料
              <b>
                {summary.material.id} <small>nD {summary.material.nD.toFixed(4)}</small>
              </b>
            </span>
            <select
              aria-label="色散材料"
              value={summary.spec.material}
              onChange={(e) => patchLens({ material: e.target.value })}
            >
              {summary.materials.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}（Vd {g.vd}）
                </option>
              ))}
            </select>
          </label>
          {solidParameters.map((p) => (
            <label className="parameter" key={p.key}>
              <span>
                {p.label}
                <b>
                  {Number(summary.spec[p.key]).toFixed(p.step < 1 ? 1 : 0)}{" "}
                  <small>{p.unit}</small>
                </b>
              </span>
              <input
                aria-label={p.label}
                type="range"
                min={p.min}
                max={p.max}
                step={p.step}
                value={Number(summary.spec[p.key])}
                onChange={(e) => patchLens({ [p.key]: Number(e.target.value) })}
              />
              <div className="range-label">
                <span>{p.min}</span>
                <span>{p.max}</span>
              </div>
            </label>
          ))}
          <div className={"solid-status " + (summary.validation.valid ? "ok" : "bad")}>
            <TriangleAlert size={13} />
            {summary.validation.valid ? (
              <span>
                实体有效 · 边缘厚度{" "}
                {summary.validation.edgeThickness?.toFixed(1) ?? "—"} mm · 近轴等效焦距{" "}
                {summary.efl !== null ? summary.efl.toFixed(0) : "∞"} mm（参考值）
              </span>
            ) : (
              <span>{summary.validation.reasons[0]}，请调整曲率或厚度</span>
            )}
          </div>
        </>
      )}
      {parameters(element).map((p) => (
        <label className="parameter" key={p.key}>
          <span>
            {p.label}
            <b>
              {Number(element[p.key]).toFixed(p.step < 1 ? 2 : 0)}{" "}
              <small>{p.unit}</small>
            </b>
          </span>
          <input
            aria-label={p.label}
            type="range"
            min={p.min}
            max={p.max}
            step={p.step}
            value={Number(element[p.key])}
            onChange={(e) =>
              onUpdate({
                [p.key]:
                  p.key === "focal" && Number(e.target.value) === 0
                    ? 10
                    : Number(e.target.value),
              })
            }
          />
          <div className="range-label">
            <span>{p.min}</span>
            <span>{p.max}</span>
          </div>
        </label>
      ))}
      <button className="delete" onClick={onRemove}>
        <Trash2 size={14} />
        移除器件
      </button>
    </section>
  );
}
