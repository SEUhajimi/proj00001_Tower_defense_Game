import { RESOURCE_NAME, type ResourceId } from '../../shared/data/economy';
import RENDERED from '../../public/assets/rendered/manifest.json';

// 资源图标（art/icons.py 渲染的小图），界面里写资源的地方都用它；鼠标停在上面显示资源名。
// 还没渲染图标的退回单字简称。

const SHORT: Record<ResourceId, string> = {
  gold: '金', food: '粮', wood: '木', stone: '石', steel: '钢', fuel: '燃', ammo: '弹', electronics: '电子',
};

const has = (r: ResourceId) => `icons/res-${r}.png` in RENDERED;

export function resIcon(r: ResourceId): string {
  const name = RESOURCE_NAME[r];
  return has(r)
    ? `<img class="ri" src="assets/rendered/icons/res-${r}.png" alt="${name}" title="${name}">`
    : `<span class="ri-text" title="${name}">${SHORT[r]}</span>`;
}

// 图标 + 数量，比如造价、产量
export function resAmount(r: ResourceId, n: string | number): string {
  return `<span class="ra" title="${RESOURCE_NAME[r]}">${resIcon(r)}${n}</span>`;
}
