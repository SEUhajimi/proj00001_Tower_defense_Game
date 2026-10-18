"""下载 Blender 渲染要用的 CC0 材质贴图（Poly Haven，https://polyhaven.com，CC0 公共领域）。

用法：python art/fetch_textures.py
贴图下到 art/textures/<名字>/ 里（不进 git），每种取 1k 分辨率的颜色、法线、粗糙度贴图。
"""
import json
import os
import urllib.request

# 名字 → Poly Haven 资源编号
TEXTURES = {
    # 地面
    'grass': 'sparse_grass',
    'aerial_grass': 'aerial_grass_rock',
    'aerial_rocks': 'aerial_rocks_02',
    'forest': 'forrest_ground_01',
    'rock': 'rocky_terrain_02',
    'laterite': 'red_laterite_soil_stones',
    'mud': 'brown_mud_02',
    'dirt': 'dirt_floor',
    'asphalt': 'asphalt_02',
    # 建筑和载具
    'concrete': 'concrete_wall_008',
    'concrete_floor': 'concrete_floor_worn_001',
    'corrugated': 'corrugated_iron_02',
    'shutter': 'painted_metal_shutter',
    'rust': 'rusty_metal_02',
    'green_metal': 'green_metal_rust',
    'metal_plate': 'metal_plate',
    'brick': 'red_brick_03',
}

MAPS = {'Diffuse': 'diff', 'nor_gl': 'nor', 'Rough': 'rough', 'arm': 'arm'}
ROOT = os.path.join(os.path.dirname(__file__), 'textures')


def get(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'baseguard-art'})).read()


def main() -> None:
    for name, asset in TEXTURES.items():
        files = json.loads(get(f'https://api.polyhaven.com/files/{asset}'))
        os.makedirs(os.path.join(ROOT, name), exist_ok=True)
        for key, short in MAPS.items():
            if key not in files:
                continue
            entry = files[key]['1k']
            fmt = 'jpg' if 'jpg' in entry else 'png'
            out = os.path.join(ROOT, name, f'{short}.{fmt}')
            if not os.path.exists(out):
                open(out, 'wb').write(get(entry[fmt]['url']))
        print('ok', name, '<-', asset)


if __name__ == '__main__':
    main()
