"""基地守卫的美术渲染脚本：在 Blender 里用代码搭模型、贴 CC0 材质，按游戏的等角视角批量渲染成图片。

用法（在项目根目录）：
  E:/tools/blender/blender.exe -b -P art/render.py -- all
  E:/tools/blender/blender.exe -b -P art/render.py -- ground barracks tank2 rifle   # 只渲染其中几样

输出到 public/assets/rendered/，并写 manifest.json（每张图的尺寸和锚点）。
贴图先用 python art/fetch_textures.py 下载。

坐标约定：游戏的格子坐标 (x, y) 对应 Blender 的 (x, -y)；1 格 = 1 个 Blender 单位，高度也按格算。
游戏画面 1 格宽 64 像素（2:1 等角）；这里按 2 倍分辨率渲染，游戏里缩小一半显示。
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

from kit import (  # noqa: E402
    OUT, TEAM, box, camera, cyl, empty, flat, manifest, pbr, render, reset, shadow_catcher, sphere,
)
import vehicles  # noqa: E402

# ---------- 地面 ----------

GROUND = {
    'plain': ('aerial_grass', (0.95, 1.0, 0.9)),
    'forest': ('rock', (0.62, 0.72, 0.55)),
    'mountain': ('aerial_rocks', (0.95, 0.93, 0.9)),
    'iron': ('laterite', (1, 0.95, 0.9)),
    'oil': ('mud', (0.55, 0.55, 0.6)),
}


GROUND_REPEAT = 3  # 贴图每 3×3 块地（12 格）才重复一次，免得大地图上花纹太规整


def render_ground() -> None:
    """一块地（4×4 格）一张地面贴图。每种地形渲染 3×3 张，分别是贴图的不同部分；
    游戏里第 (px, py) 块地用第 (px % 3, py % 3) 张，相邻的拼起来正好无缝。"""
    n = GROUND_REPEAT
    for terrain, (tex, tint) in GROUND.items():
        for i in range(n):
            for j in range(n):
                reset()
                bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, 0))
                plane = bpy.context.active_object
                # 游戏的 y 在 Blender 里是 -y，所以 j 方向的偏移取负
                plane.data.materials.append(pbr(f'g_{terrain}', tex, scale=1 / (4 * n), tint=tint, offset=(i / n, -j / n)))
                w = int(4 * 64 * 2)
                camera(w, w // 2)
                bpy.context.scene.cycles.samples = 24
                render(f'ground/{terrain}-{i}{j}.png', w, w // 2, 0)


# ---------- 兵营：半圆拱形营房（铁皮）+ 混凝土地坪 + 沙袋 + 旗杆 ----------

def build_barracks(team: str):
    root = empty('barracks')
    concrete = pbr('concrete', 'concrete_floor', 0.6)
    iron = pbr('corrugated', 'corrugated', 1.5, tint=(0.62, 0.66, 0.55), metal=0.3)
    wall = pbr('wall', 'concrete', 1.0, tint=(0.8, 0.78, 0.72))
    sand = flat('sand', (0.55, 0.47, 0.33), rough=0.95)
    dark = flat('dark', (0.06, 0.06, 0.05), rough=0.5)
    door = pbr('door', 'shutter', 1.0, tint=(0.45, 0.5, 0.38))

    box((2.8, 2.8, 0.08), (0, 0, 0.04), concrete, bevel=0.02, parent=root)
    # 拱形营房：横放的半圆柱，沿 x 方向（游戏里朝右下）
    hut = cyl(0.78, 2.2, (0.1, 0.25, 0.08), iron, rot=(0, math.radians(90), 0), verts=28, parent=root)
    bpy.context.view_layer.objects.active = hut
    # 只留上半个圆柱
    mod = hut.modifiers.new('cut', 'BOOLEAN')
    cutter = box((3, 2, 1), (0.1, 0.25, -0.42), dark)
    mod.object = cutter
    mod.operation = 'DIFFERENCE'
    cutter.hide_render = True
    # 两头的墙和门
    for sx in (-1, 1):
        end = cyl(0.76, 0.06, (0.1 + sx * 1.08, 0.25, 0.08), wall, rot=(0, math.radians(90), 0), verts=28, parent=root)
        m2 = end.modifiers.new('cut', 'BOOLEAN')
        m2.object = cutter
        m2.operation = 'DIFFERENCE'
    box((0.06, 0.42, 0.5), (1.21, 0.25, 0.33), door, parent=root)
    # 侧面的小窗
    for k in (-0.5, 0.1, 0.7):
        box((0.22, 0.04, 0.14), (k, -0.47, 0.5), dark, rot=(math.radians(-25), 0, 0), parent=root)
    # 沙袋墙
    for k in range(5):
        box((0.26, 0.16, 0.12), (-1.05 + k * 0.27, -1.05, 0.14), sand, bevel=0.04, parent=root)
        box((0.26, 0.16, 0.12), (-0.92 + k * 0.27, -1.05, 0.26), sand, bevel=0.04, parent=root)
    # 旗杆和阵营旗
    cyl(0.025, 1.6, (1.15, -1.1, 0.88), flat('pole', (0.6, 0.6, 0.62), metal=0.8, rough=0.3), parent=root)
    box((0.02, 0.42, 0.26), (1.15, -0.88, 1.5), flat('flag', TEAM[team], rough=0.8), parent=root)
    # 物资箱
    crate = pbr('crate', 'green_metal', 2.0, tint=(0.7, 0.75, 0.55))
    box((0.3, 0.3, 0.26), (-1.1, 0.95, 0.21), crate, bevel=0.02, parent=root)
    box((0.3, 0.3, 0.26), (-0.75, 1.0, 0.21), crate, bevel=0.02, parent=root)
    box((0.3, 0.3, 0.26), (-0.92, 0.97, 0.47), crate, bevel=0.02, parent=root)
    return root


def render_building(name: str, size: int, builder) -> None:
    for team in ('player', 'enemy'):
        reset()
        shadow_catcher()
        builder(team)
        w = int(size * 64 * 2 * 1.25)
        camera(w, w, shift_y=0.12)
        render(f'buildings/{name}-{team}.png', w, w, 0.12)


# ---------- 步兵：头盔、上身、腿、步枪，16 个朝向 ----------

def build_soldier(team: str, weapon: str = 'rifle'):
    root = empty('soldier')
    uniform = flat('uniform', (0.07, 0.085, 0.04), rough=0.85)
    dark = flat('boots', (0.07, 0.06, 0.05), rough=0.8)
    skin = flat('skin', (0.55, 0.36, 0.26), rough=0.6)
    helmet = flat('helmet', (0.06, 0.075, 0.035), rough=0.6)
    gun = flat('gun', (0.08, 0.08, 0.08), rough=0.4, metal=0.5)
    s = 0.62
    for side in (-1, 1):
        box((0.07 * s, 0.07 * s, 0.32 * s), (0.02 * s, side * 0.06 * s, 0.17 * s), uniform, bevel=0.01, parent=root)
        box((0.11 * s, 0.07 * s, 0.05 * s), (0.04 * s, side * 0.06 * s, 0.025 * s), dark, parent=root)
    box((0.13 * s, 0.22 * s, 0.3 * s), (0, 0, 0.47 * s), uniform, bevel=0.02, parent=root)
    box((0.1 * s, 0.18 * s, 0.2 * s), (-0.1 * s, 0, 0.5 * s), flat('pack', (0.12, 0.1, 0.06), rough=0.9), bevel=0.02, parent=root)
    box((0.02 * s, 0.24 * s, 0.05 * s), (0.065 * s, 0, 0.55 * s), flat('band', TEAM[team]), parent=root)
    sphere(0.075 * s, (0.01 * s, 0, 0.7 * s), skin, parent=root)
    sphere(0.095 * s, (0, 0, 0.74 * s), helmet, scale=(1, 1, 0.65), parent=root)
    # 双臂端枪
    for side in (-1, 1):
        box((0.22 * s, 0.06 * s, 0.06 * s), (0.1 * s, side * 0.1 * s, 0.5 * s), uniform, rot=(0, math.radians(15), side * math.radians(-12)), parent=root)
    length = {'rifle': 0.42, 'smg': 0.28, 'mg': 0.5, 'sniper': 0.58, 'sapper': 0.3}[weapon]
    box((length * s, 0.035 * s, 0.05 * s), (0.2 * s + length * s / 2 - 0.1 * s, 0.03 * s, 0.53 * s), gun, parent=root)
    return root


def render_directions(name: str, builder, size_px: int, shift: float, dirs: int = 16, shadow: bool = True) -> None:
    """单位按游戏里的朝向转一圈渲染：第 k 张对应游戏里朝向角 k × 360°/dirs（0 = 朝游戏 +x）。
    飞机不带地面影子（游戏里单独画影子），锚点是机身中心。"""
    for team in ('player', 'enemy'):
        reset()
        if shadow:
            shadow_catcher(4)
        root = builder(team)
        camera(size_px, size_px, shift_y=shift)
        bpy.context.scene.cycles.samples = 32
        for k in range(dirs):
            a = k * 2 * math.pi / dirs
            root.rotation_euler = (0, 0, -a)  # 游戏的 y 轴在 Blender 里是 -y
            render(f'units/{name}-{team}-{k:02d}.png', size_px, size_px, shift)


# ---------- 入口 ----------

JOBS = {
    'ground': render_ground,
    'barracks': lambda: render_building('barracks', 3, build_barracks),
    'rifle': lambda: render_directions('rifle', lambda t: build_soldier(t, 'rifle'), 112, 0.12),
    'axes': lambda: render_axes(),
    'preview': lambda: render_preview(),
}
# 坦克和飞机：每个型号一项（vehicles.py 里的 MODELS）
for _id, (_build, _px, _air) in vehicles.MODELS.items():
    JOBS[_id] = (lambda b, i, px, air: lambda: render_directions(i, b, px, 0.0 if air else 0.06, shadow=not air))(_build, _id, _px, _air)


def render_preview() -> None:
    """检查用：每个坦克、飞机型号渲染一张 3/4 侧面图到 debug/。"""
    for name, (build, px, air) in vehicles.MODELS.items():
        reset()
        if not air:
            shadow_catcher(4)
        root = build('player')
        root.rotation_euler = (0, 0, -math.radians(-60))
        camera(px, px, shift_y=0 if air else 0.06)
        render(f'debug/preview-{name}.png', px, px, 0)


def render_axes() -> None:
    """标定用：红色条沿游戏 +x，绿色条沿游戏 +y，看渲染出来的方向对不对。"""
    reset()
    box((2, 0.1, 0.1), (1, 0, 0.05), flat('x', (1, 0, 0)))
    box((0.1, 2, 0.1), (0, -1, 0.05), flat('y', (0, 1, 0)))
    box((0.1, 0.1, 1), (0, 0, 0.5), flat('z', (0, 0, 1)))
    camera(512, 512)
    render('debug/axes.png', 512, 512, 0)


def main() -> None:
    args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['all']
    jobs = [j for j in JOBS if j not in ('axes', 'preview')] if 'all' in args else args
    path = os.path.join(OUT, 'manifest.json')
    if os.path.exists(path):
        manifest.update(json.load(open(path, encoding='utf8')))
    for j in jobs:
        JOBS[j]()
    os.makedirs(OUT, exist_ok=True)
    keep = {k: v for k, v in manifest.items() if not k.startswith('debug/')}  # 调试图不进清单
    json.dump(keep, open(path, 'w', encoding='utf8'), ensure_ascii=False, indent=1, sort_keys=True)


main()
