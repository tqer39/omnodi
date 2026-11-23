type Point = { x: number; y: number };
export type LabelBox = Point & { width: number; height: number };

const gap = 6;
const overlaps = (a: LabelBox, b: LabelBox) =>
  a.x < b.x + b.width + gap &&
  a.x + a.width + gap > b.x &&
  a.y < b.y + b.height + gap &&
  a.y + a.height + gap > b.y;

/**
 * 画面に正対させたラベルを、投影後の座標で重ならない近くの位置へ置く。
 * 上下の移動を優先し、左右へ半幅・全幅ずらす候補も試して、立体から遠く離れないようにする。
 */
export function placeSpatialLabel(box: LabelBox, occupied: LabelBox[]): LabelBox {
  const reach = 180;
  const nearby = occupied.filter(
    (other) =>
      other.x < box.x + box.width * 2 + reach &&
      other.x + other.width > box.x - box.width - reach &&
      other.y < box.y + box.height + reach &&
      other.y + other.height > box.y - reach,
  );
  const candidates: { dx: number; dy: number; cost: number }[] = [];
  for (let dy = -reach; dy <= reach; dy += 8)
    for (const dx of [0, -box.width / 2, box.width / 2, -box.width, box.width])
      candidates.push({ dx, dy, cost: Math.abs(dy) + Math.abs(dx) * 1.3 });
  candidates.sort((a, b) => a.cost - b.cost);
  for (const { dx, dy } of candidates) {
    const candidate = { ...box, x: box.x + dx, y: box.y + dy };
    if (!nearby.some((other) => overlaps(candidate, other))) {
      occupied.push(candidate);
      return candidate;
    }
  }
  // 近くに空きがなければ、上下で最も近い空き位置まで動かす。
  let above = box.y;
  let below = box.y;
  const column = occupied.filter(
    (other) => box.x < other.x + other.width + gap && box.x + box.width + gap > other.x,
  );
  const blocks = (top: number, other: LabelBox) =>
    top < other.y + other.height + gap && top + box.height + gap > other.y;
  for (const other of [...column].sort((a, b) => b.y + b.height - a.y - a.height))
    if (blocks(above, other)) above = other.y - box.height - gap;
  for (const other of [...column].sort((a, b) => a.y - b.y))
    if (blocks(below, other)) below = other.y + other.height + gap;
  const placed = { ...box, y: box.y - above <= below - box.y ? above : below };
  occupied.push(placed);
  return placed;
}
