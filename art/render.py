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
    OUT, TEAM, box, camera, cyl, empty, flat, lift_px, manifest, pbr, render, reset, shadow_catcher, sphere, top_height,
)
import buildings  # noqa: E402
import props  # noqa: E402
import damage  # noqa: E402
import fx  # noqa: E402
import icons  # noqa: E402
import levels  # noqa: E402
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


# ---------- 建筑 ----------

def building_canvas(size: int) -> tuple[int, int, float]:
    """按已经搭好的模型定图的大小：比占地菱形宽一圈，右下留出影子；越高的建筑图越高、影子越长。
    返回 (宽, 高, 相机下移量)。"""
    z = top_height()
    w = int(size * 160 + 60 + z * 90)
    below = 0.42 * w  # 占地中心以下：下半个菱形和影子
    h = int(max(w, below + lift_px(z) * 2 + size * 32 + 30))
    return w, h, (h - below - h / 2) / max(w, h)


def render_building(name: str, size: int, builder, teams=('player', 'enemy'), variants=('', 'damaged')) -> None:
    """一种建筑一张图（分阵营的各一张），再各出一张受损的（-damaged）。锚点是占地中心，manifest 里另记 lift：
    建筑最高点在画面上比占地中心高多少像素（游戏里 1 倍显示，放血条用）。受损图的画布和 lift 跟完好的一样。"""
    for team in teams:
        for variant in variants:
            reset()
            shadow_catcher()
            builder(team)
            w, h, shift = building_canvas(size)
            lift = round(lift_px(top_height()), 1)
            if variant == 'damaged':
                damage.damage(size, sum(map(ord, name)))
            camera(w, h, shift_y=shift)
            suffix = f'-{variant}' if variant else ''
            render(f'buildings/{name}-{team}{suffix}.png', w, h, shift, {'lift': lift})


def render_airfield(variants=('', 'damaged')) -> None:
    """机场（8×4）：两个朝向 × 1–5 级（机库座数）各一张，再各一张受损的。
    画布按 6×6 的正方形算（等角投影下 8×4 的外框和 6×6 一样大）。"""
    for rot in (0, 1):
        for level in range(1, 6):
            for variant in variants:
                reset()
                shadow_catcher(14)
                buildings.airfield('player', level, rot)
                w, h, shift = building_canvas(6)
                lift = round(lift_px(top_height()), 1)
                if variant == 'damaged':
                    damage.damage(4, 977 + level * 13 + rot)
                camera(w, h, shift_y=shift)
                suffix = f'-{variant}' if variant else ''
                render(f'buildings/airfield-player-r{rot}-l{level}{suffix}.png', w, h, shift, {'lift': lift})


def render_ruins(name: str, size: int, builder) -> None:
    """废墟（通用瓦砾堆）：锚点是占地中心。"""
    reset()
    shadow_catcher()
    builder()
    w, h, shift = building_canvas(size)
    camera(w, h, shift_y=shift)
    render(f'ruins/{name}.png', w, h, shift)


def render_prop(name: str, builder) -> None:
    """树丛、石堆：占 2×2 格，锚点是这 2×2 格的中心，不分阵营。"""
    reset()
    shadow_catcher()
    builder()
    w, h, shift = building_canvas(2)
    camera(w, h, shift_y=shift)
    render(f'props/{name}.png', w, h, shift, {'lift': round(lift_px(top_height()), 1)})


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
    if weapon == 'sniper':  # 狙击兵戴奔尼帽，背上披一块吉利伪装
        cyl(0.13 * s, 0.012 * s, (0, 0, 0.75 * s), flat('boonie', (0.2, 0.2, 0.1), rough=0.9), verts=16, parent=root)
        sphere(0.075 * s, (0, 0, 0.77 * s), flat('boonie', (0.2, 0.2, 0.1), rough=0.9), scale=(1, 1, 0.6), parent=root)
        sphere(0.16 * s, (-0.06 * s, 0, 0.5 * s), flat('ghillie', (0.08, 0.09, 0.035), rough=1), scale=(0.8, 1, 1.3), parent=root)
    else:
        sphere(0.095 * s, (0, 0, 0.74 * s), helmet, scale=(1, 1, 0.65), parent=root)
    # 双臂端枪
    for side in (-1, 1):
        box((0.22 * s, 0.06 * s, 0.06 * s), (0.1 * s, side * 0.1 * s, 0.5 * s), uniform, rot=(0, math.radians(15), side * math.radians(-12)), parent=root)
    length = {'rifle': 0.42, 'smg': 0.28, 'mg': 0.5, 'sniper': 0.58, 'sapper': 0.3}[weapon]
    box((length * s, 0.035 * s, 0.05 * s), (0.2 * s + length * s / 2 - 0.1 * s, 0.03 * s, 0.53 * s), gun, parent=root)
    tip = 0.1 * s + length * s
    if weapon == 'smg':  # 冲锋枪：弹匣
        box((0.03 * s, 0.03 * s, 0.1 * s), (0.2 * s, 0.03 * s, 0.46 * s), gun, parent=root)
    elif weapon == 'mg':  # 机枪：粗枪管、两脚架，腰间挂弹药箱和弹链
        box((length * 0.4 * s, 0.06 * s, 0.08 * s), (0.25 * s, 0.03 * s, 0.53 * s), gun, parent=root)
        for side in (-1, 1):
            box((0.01 * s, 0.01 * s, 0.12 * s), (tip - 0.05 * s, 0.03 * s + side * 0.03 * s, 0.47 * s), gun, rot=(side * math.radians(20), 0, 0), parent=root)
        box((0.09 * s, 0.07 * s, 0.07 * s), (0.18 * s, -0.08 * s, 0.42 * s), flat('ammo', (0.18, 0.2, 0.1), rough=0.7), parent=root)
        box((0.02 * s, 0.05 * s, 0.1 * s), (0.26 * s, -0.02 * s, 0.48 * s), flat('brass', (0.6, 0.45, 0.15), metal=0.8, rough=0.3), parent=root)
    elif weapon == 'sniper':  # 狙击枪：瞄准镜
        cyl(0.018 * s, 0.14 * s, (0.25 * s, 0.03 * s, 0.58 * s), gun, rot=(0, math.radians(90), 0), verts=10, parent=root)
    elif weapon == 'sapper':  # 爆破兵：背上的炸药包和工兵铲
        box((0.1 * s, 0.2 * s, 0.22 * s), (-0.14 * s, 0, 0.5 * s), flat('charge', (0.55, 0.12, 0.06), rough=0.7), bevel=0.02, parent=root)
        for z in (0.44, 0.56):
            box((0.11 * s, 0.21 * s, 0.02 * s), (-0.14 * s, 0, z * s), flat('tape', (0.75, 0.65, 0.1), rough=0.6), parent=root)
        box((0.015 * s, 0.015 * s, 0.3 * s), (-0.2 * s, 0.1 * s, 0.6 * s), flat('handle', (0.3, 0.2, 0.1), rough=0.8), rot=(math.radians(15), 0, 0), parent=root)
        box((0.06 * s, 0.01 * s, 0.08 * s), (-0.2 * s, 0.14 * s, 0.77 * s), gun, rot=(math.radians(15), 0, 0), parent=root)
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
    'rifle': lambda: render_directions('rifle', lambda t: build_soldier(t, 'rifle'), 112, 0.12),
    'smg': lambda: render_directions('smg', lambda t: build_soldier(t, 'smg'), 112, 0.12),
    'mg': lambda: render_directions('mg', lambda t: build_soldier(t, 'mg'), 112, 0.12),
    'sniper': lambda: render_directions('sniper', lambda t: build_soldier(t, 'sniper'), 112, 0.12),
    'sapper': lambda: render_directions('sapper', lambda t: build_soldier(t, 'sapper'), 112, 0.12),
    'axes': lambda: render_axes(),
    'preview': lambda: render_preview(),
    'bpreview': lambda: render_building_preview(),
    'spreview': lambda: render_soldier_preview(),
}
# 建筑：每种一项（buildings.py 里的 BUILDINGS）
for _id, (_build, _size, _both) in buildings.BUILDINGS.items():
    JOBS[_id] = (lambda i, b, sz, both: lambda: render_building(i, sz, b, ('player', 'enemy') if both else ('player',)))(_id, _build, _size, _both)
# 单个建筑只渲染受损图：hall-damaged 这样
for _id, (_b, _sz, _both) in buildings.BUILDINGS.items():
    JOBS[f'{_id}-damaged'] = (lambda i, b, sz, both: lambda: render_building(i, sz, b, ('player', 'enemy') if both else ('player',), ('damaged',)))(_id, _b, _sz, _both)
JOBS['airfield'] = render_airfield


def render_icons() -> None:
    """资源图标：每种 128×128 一张，带一点影子，界面里缩小显示。"""
    for name, build in icons.ICONS.items():
        reset()
        shadow_catcher(3)
        build()
        camera(128, 128)
        fit_camera(0.1)
        bpy.context.scene.cycles.samples = 32
        render(f'icons/res-{name}.png', 128, 128, 0)


def fit_camera(margin: float) -> None:
    """把相机对准场景里的物件（不算影子接收面），缩放到刚好装下、四周留 margin 的空。"""
    from bpy_extras.object_utils import world_to_camera_view
    sc = bpy.context.scene
    cam = sc.camera
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    xs, ys = [], []
    for o in sc.objects:
        if o.type != 'MESH' or o.is_shadow_catcher or o.hide_render:
            continue
        ev = o.evaluated_get(deps)
        for v in ev.data.vertices:
            p = world_to_camera_view(sc, cam, ev.matrix_world @ v.co)
            xs.append(p.x)
            ys.append(p.y)
    size = max(max(xs) - min(xs), max(ys) - min(ys)) * (1 + margin * 2)
    old = cam.data.ortho_scale
    cam.data.shift_x = ((min(xs) + max(xs)) / 2 - 0.5) / size
    cam.data.shift_y = ((min(ys) + max(ys)) / 2 - 0.5) / size
    cam.data.ortho_scale = old * size


JOBS['icons'] = render_icons


def render_airfield_preview() -> None:
    """检查用：机场 3 级横放、5 级竖放各一张快速图到 debug/。"""
    for rot, level in ((0, 3), (1, 5)):
        reset()
        shadow_catcher(14)
        buildings.airfield('player', level, rot)
        w, h, shift = building_canvas(6)
        camera(w, h, shift_y=shift)
        bpy.context.scene.cycles.samples = 12
        render(f'debug/airfield-r{rot}-l{level}.png', w, h, shift)


JOBS['afpreview'] = render_airfield_preview
# 能升级的建筑：每种一项，1–5 级各一张、再各一张受损的（buildings/hall-player-l3.png）
def render_leveled(name: str, builder, size: int, variants=('', 'damaged')) -> None:
    for level in range(1, 6):
        for variant in variants:
            reset()
            shadow_catcher()
            builder('player', level)
            w, h, shift = building_canvas(size)
            lift = round(lift_px(top_height()), 1)
            if variant == 'damaged':
                damage.damage(size, sum(map(ord, name)) + level)
            camera(w, h, shift_y=shift)
            suffix = f'-{variant}' if variant else ''
            render(f'buildings/{name}-player-l{level}{suffix}.png', w, h, shift, {'lift': lift})


for _id, (_build, _size) in levels.LEVELED.items():
    JOBS[_id] = (lambda i, b, sz: lambda: render_leveled(i, b, sz))(_id, _build, _size)


def render_levels_preview(only=None) -> None:
    """检查用：每种能升级的建筑 1–5 级快速各渲染一张到 debug/levels/（only 只渲染这一种）。"""
    for name, (build, size) in levels.LEVELED.items():
        if only and name != only:
            continue
        for level in range(1, 6):
            reset()
            shadow_catcher()
            build('player', level)
            w, h, shift = building_canvas(size)
            camera(w, h, shift_y=shift)
            bpy.context.scene.cycles.samples = 6
            render(f'debug/levels/{name}-l{level}.png', w, h, shift)


JOBS['lpreview'] = render_levels_preview
for _id in levels.LEVELED:
    JOBS[f'{_id}-preview'] = (lambda i: lambda: render_levels_preview(i))(_id)
# 只渲染受损图（完好的已经有了）
JOBS['damaged'] = lambda: [render_building(i, sz, b, ('player', 'enemy') if both else ('player',), ('damaged',))
                           for i, (b, sz, both) in buildings.BUILDINGS.items()]
# 废墟：每张一项（damage.py 里的 RUINS），ruins 一次全渲染
for _id, (_size, _build) in damage.RUINS.items():
    JOBS[f'ruin-{_id}'] = (lambda i, sz, b: lambda: render_ruins(i, sz, b))(_id, _size, _build)
JOBS['ruins'] = lambda: [JOBS[f'ruin-{i}']() for i in damage.RUINS]
# 特效：explosion smoke fire flash
JOBS.update(fx.FX)
# 树丛、石堆：每张一项（props.py 里的 PROPS）
for _id, _build in props.PROPS.items():
    JOBS[_id] = (lambda i, b: lambda: render_prop(i, b))(_id, _build)
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


def render_soldier_preview() -> None:
    """检查用：四种步兵各一张侧面放大图到 debug/。"""
    for w in ('rifle', 'smg', 'mg', 'sniper', 'sapper'):
        reset()
        shadow_catcher(4)
        root = build_soldier('player', w)
        root.rotation_euler = (0, 0, math.radians(60))
        root.scale = (3, 3, 3)
        camera(320, 320, 0.15)
        bpy.context.scene.cycles.samples = 16
        render(f'debug/soldier-{w}.png', 320, 320, 0)


def render_building_preview() -> None:
    """检查用：每种建筑快速渲染一张（采样少）到 debug/buildings/。"""
    for name, (build, size, _) in buildings.BUILDINGS.items():
        reset()
        shadow_catcher()
        build('player')
        w, h, shift = building_canvas(size)
        camera(w, h, shift_y=shift)
        bpy.context.scene.cycles.samples = 8
        render(f'debug/buildings/{name}.png', w, h, shift)


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
    skip = ('axes', 'preview', 'bpreview', 'spreview', 'afpreview', 'lpreview', 'damaged', 'ruins')
    skip += tuple(j for j in JOBS if j.endswith('-preview'))  # damaged、ruins 和单项重复
    jobs = [j for j in JOBS if j not in skip] if 'all' in args else args
    path = os.path.join(OUT, 'manifest.json')
    if os.path.exists(path):
        manifest.update(json.load(open(path, encoding='utf8')))
    for j in jobs:
        JOBS[j]()
    os.makedirs(OUT, exist_ok=True)
    keep = {k: v for k, v in manifest.items() if not k.startswith('debug/')}  # 调试图不进清单
    json.dump(keep, open(path, 'w', encoding='utf8'), ensure_ascii=False, indent=1, sort_keys=True)


main()
