"""能升级的基地建筑：每种一个函数 builder(team, level)，同一块占地上 1–5 级长得不一样。

设计原则：
  - 每种建筑一个一眼认得出的“招牌”外形（冷却塔、筒仓、井架、蒸馏塔、锯齿屋顶……），
    再按类别配色：民生暖色（红瓦、米墙），资源土色，工业深色带橙红点缀，仓储各有专色。
  - 等级越高，同一块地上东西越多、越高：几级就有几座筒仓 / 几台抽油机 / 几座油罐，
    或者从一间小屋长成一整片厂区。玩家看外形就知道大概几级。
坐标同 kit.py：占地中心为原点，相机在 +x、-y 方向的上空，高的东西放后面（-x、+y），门脸朝 +x 和 -y。
"""
import math

import bpy

from kit import box, cyl, empty, flat, pbr, sphere
from vehicles import extrude
from buildings import arch, cone, crates, flag, gable, mats, pad, prism, rod, tank_storage, tree, windows_x, windows_y


# ---------- 小部件 ----------

def ground(root, s, mat, h=0.04):
    return box((s * 0.97, s * 0.97, h), (0, 0, h / 2), mat, bevel=0.015, parent=root)


def lathe(root, profile, x, y, mat, verts=32, z0=0.0):
    """旋转体：profile 是一串 (半径, 高度)，绕竖轴转一圈（冷却塔、筒仓顶）。"""
    vs, faces = [], []
    n = len(profile)
    for i, (r, z) in enumerate(profile):
        for k in range(verts):
            a = 2 * math.pi * k / verts
            vs.append((x + r * math.cos(a), y + r * math.sin(a), z0 + z))
    for i in range(n - 1):
        for k in range(verts):
            a, b = i * verts + k, i * verts + (k + 1) % verts
            faces.append((a, b, b + verts, a + verts))
    me = bpy.data.meshes.new('lathe')
    me.from_pydata(vs, [], faces)
    me.update()
    o = bpy.data.objects.new('lathe', me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    for p in me.polygons:
        p.use_smooth = True
    o.parent = root
    return o


def steam(root, x, y, z, s=1.0):
    """冒出的白汽：几团叠在一起的软球。"""
    m = flat('steam', (0.92, 0.93, 0.95), rough=1.0)
    for k, (dx, dy, dz, r) in enumerate([(0, 0, 0, 0.16), (0.08, 0.05, 0.12, 0.13), (-0.05, 0.1, 0.22, 0.11), (0.06, 0.15, 0.32, 0.08)]):
        sphere(r * s, (x + dx * s, y + dy * s, z + dz * s), m, parent=root)


def chimney(root, x, y, h, r=0.07, mat=None, red=None):
    """红白相间的烟囱。"""
    m = mats()
    cyl(r, h, (x, y, h / 2), mat or m['concrete'], verts=20, parent=root)
    for k in range(2):
        cyl(r * 1.04, h * 0.07, (x, y, h * (0.78 + k * 0.14)), red or m['red'], verts=20, parent=root)


def sign(root, x, y, z, w, h, color, along='y'):
    """招牌：一块彩色牌子（朝 -y 或 +x）。"""
    size = (w, 0.03, h) if along == 'y' else (0.03, w, h)
    return box(size, (x, y, z), flat('sign', color, rough=0.5), bevel=0.005, parent=root)


def small_tree_row(root, pts, s=0.6):
    for x, y in pts:
        tree(root, x, y, s)


# ---------- 民生 ----------

def hall(team, level=1):
    """市政厅：白色新古典主楼和柱廊。2 级加两翼，3 级加钟楼和绿铜圆顶，4 级圆顶加高、门前花园，5 级金顶、后楼和喷泉。"""
    root, m = empty('hall'), mats()
    L = level
    box((2.9, 2.9, 0.05), (0, 0, 0.025), pbr('plaza', 'concrete_floor', 0.8, tint=(1.05, 1.02, 0.95)), bevel=0.02, parent=root)
    white = pbr('marble', 'concrete', 1.2, tint=(1.25, 1.22, 1.15))
    h = 0.75 + 0.1 * min(L, 3)
    box((1.4, 1.1, h), (-0.25, 0.35, h / 2 + 0.05), white, bevel=0.02, parent=root)
    box((1.5, 1.2, 0.06), (-0.25, 0.35, h + 0.08), m['concrete'], parent=root)
    windows_x(root, -0.1, 0.8, 0.455, [0.35 + 0.3 * k for k in range(int(h / 0.32))], m['glass'], 3)
    if L >= 2:  # 两翼
        for sx, sy in ((-1, 0), (0, 1)):
            cx, cy = (-0.25 - 0.95, 0.35) if sx else (-0.25, 0.35 + 0.85)
            size = (0.5, 1.0, h - 0.2) if sx else (1.0, 0.5, h - 0.2)
            box(size, (cx, cy, (h - 0.2) / 2 + 0.05), white, bevel=0.02, parent=root)
            box((size[0] + 0.08, size[1] + 0.08, 0.05), (cx, cy, h - 0.12), m['concrete'], parent=root)
    # 柱廊和山花
    ncol = 4 if L < 5 else 6
    span = 1.2 if L < 5 else 1.5
    for k in range(ncol):
        cyl(0.05, h - 0.1, (-0.25 - span / 2 + k * span / (ncol - 1), -0.42, h / 2), m['white'], verts=14, parent=root)
    box((span + 0.25, 0.36, 0.08), (-0.25, -0.38, h), m['concrete'], parent=root)
    extrude('pediment', [(-0.25 - span / 2 - 0.12, h + 0.04), (-0.25 + span / 2 + 0.12, h + 0.04), (-0.25, h + 0.3)], 'y', -0.56, -0.2, white, root)
    for k in range(3):  # 台阶
        box((span + 0.2 - k * 0.1, 0.12, 0.03 + k * 0.03), (-0.25, -0.66 + k * 0.1, 0.05 + (0.03 + k * 0.03) / 2), m['concrete'], parent=root)
    if L >= 3:  # 钟楼 + 圆顶
        th = 0.45 + 0.2 * (L - 3)
        box((0.5, 0.5, th), (-0.25, 0.35, h + 0.1 + th / 2), white, bevel=0.02, parent=root)
        cyl(0.11, 0.02, (-0.25, 0.095, h + 0.1 + th * 0.6), m['white'], rot=(math.radians(90), 0, 0), verts=24, parent=root)
        dome = flat('gold', (0.95, 0.68, 0.2), rough=0.25, metal=1.0) if L >= 5 else flat('copper', (0.25, 0.5, 0.42), rough=0.45, metal=0.3)
        top = h + 0.1 + th
        if L >= 4:
            cyl(0.28, 0.18, (-0.25, 0.35, top + 0.09), white, verts=24, parent=root)
            top += 0.18
        sphere(0.28, (-0.25, 0.35, top), dome, scale=(1, 1, 0.85), parent=root)
        cyl(0.04, 0.2, (-0.25, 0.35, top + 0.3), dome, verts=10, parent=root)
    if L >= 5:  # 后楼
        box((1.0, 0.6, h + 0.25), (-0.95, 1.0, (h + 0.25) / 2 + 0.05), white, bevel=0.02, parent=root)
    flag(root, 0.75, -1.15, team, 1.3 + 0.1 * L)
    if L >= 2:
        flag(root, -1.25, -1.15, team, 1.3 + 0.1 * L)
    if L >= 4:  # 花园
        box((0.9, 0.5, 0.04), (0.85, -0.3, 0.07), m['grass'], parent=root)
        small_tree_row(root, [(1.15, 0.3), (1.15, 0.8)], 0.8)
    if L >= 5:  # 喷泉
        cyl(0.28, 0.08, (0.8, -0.95, 0.09), m['concrete'], verts=28, parent=root)
        cyl(0.24, 0.02, (0.8, -0.95, 0.13), flat('water', (0.15, 0.35, 0.55), rough=0.05), verts=28, parent=root)
        cyl(0.03, 0.25, (0.8, -0.95, 0.24), white, verts=10, parent=root)
    return root


def _cottage(root, x, y, w, d, m, roof):
    box((w, d, 0.42), (x, y, 0.25), pbr('stucco', 'concrete', 1.0, tint=(1.15, 1.05, 0.85)), bevel=0.01, parent=root)
    gable(root, x, y, w + 0.12, d + 0.12, 0.3, 0.46, roof)
    box((0.12, 0.02, 0.24), (x + w * 0.2, y - d / 2 - 0.005, 0.16), m['planks'], parent=root)
    windows_y(root, x - w / 2 + 0.08, x, y - d / 2 - 0.005, (0.3,), m['glass'], 1, w=0.13, h=0.12)
    windows_x(root, y - d / 2 + 0.1, y + d / 2 - 0.1, x + w / 2 + 0.005, (0.3,), m['glass'], 2, w=0.12, h=0.12)


def _apartment(root, x, y, w, d, floors, m, color):
    wall = pbr('apt', 'concrete', 1.0, tint=color)
    h = floors * 0.3
    box((w, d, h), (x, y, h / 2 + 0.04), wall, bevel=0.015, parent=root)
    box((w + 0.06, d + 0.06, 0.05), (x, y, h + 0.06), m['concrete'], parent=root)
    zs = [0.2 + 0.3 * k for k in range(floors)]
    windows_y(root, x - w / 2 + 0.05, x + w / 2 - 0.05, y - d / 2 - 0.005, zs, m['glass'], max(2, int(w / 0.22)), w=0.12, h=0.14)
    windows_x(root, y - d / 2 + 0.05, y + d / 2 - 0.05, x + w / 2 + 0.005, zs, m['glass'], max(2, int(d / 0.22)), w=0.12, h=0.14)
    for z in zs[1:]:  # 阳台
        box((w * 0.9, 0.08, 0.02), (x, y - d / 2 - 0.04, z - 0.1), m['concrete'], parent=root)
    return h


def house(team, level=1):
    """民居：红瓦米墙。1 级一座小屋，2 级两座，3 级一排联排房，4 级三层公寓，5 级五层公寓楼（楼顶水箱）。"""
    root, m = empty('house'), mats()
    L = level
    ground(root, 2, m['grass'])
    roof = pbr('redroof', 'roof', 2.0, tint=(0.95, 0.5, 0.38))
    if L == 1:
        _cottage(root, -0.15, 0.2, 0.9, 0.7, m, roof)
        tree(root, 0.55, 0.55, 0.75)
    elif L == 2:
        _cottage(root, -0.4, 0.35, 0.75, 0.6, m, roof)
        _cottage(root, 0.45, -0.3, 0.7, 0.55, m, roof)
        tree(root, 0.6, 0.6, 0.7)
    elif L == 3:
        for k in range(3):
            _cottage(root, -0.55 + k * 0.55, 0.3, 0.5, 0.75, m, roof)
        box((1.6, 0.25, 0.03), (0, -0.4, 0.06), m['dirt'], parent=root)
        tree(root, 0.65, -0.6, 0.7)
    elif L == 4:
        h = _apartment(root, -0.2, 0.3, 1.3, 0.8, 3, m, (1.2, 1.0, 0.8))
        gable(root, -0.2, 0.3, 1.4, 0.9, 0.25, h + 0.08, roof)
        tree(root, 0.6, -0.55, 0.75)
    else:
        h = _apartment(root, -0.2, 0.3, 1.2, 0.85, 5, m, (1.1, 0.95, 0.85))
        cyl(0.13, 0.22, (-0.4, 0.45, h + 0.2), m['rust'], verts=16, parent=root)  # 水箱
        for dx in (-0.08, 0.08):
            cyl(0.012, 0.12, (-0.4 + dx, 0.45, h + 0.1), m['steel'], verts=6, parent=root)
        box((0.5, 0.4, 0.03), (0.55, -0.55, 0.06), m['sand'], parent=root)  # 小操场
        cyl(0.01, 0.25, (0.45, -0.5, 0.18), m['pipe'], verts=6, parent=root)
        tree(root, 0.7, 0.55, 0.7)
    # 篱笆
    for k in range(7):
        box((0.03, 0.03, 0.15), (-0.2 + k * 0.15, -0.92, 0.08), m['planks'], parent=root)
    return root


def market(team, level=1):
    """市场：彩色遮阳棚的摊位。几级就多几个摊位；3 级起后排有店面，4 级两层商场带招牌，5 级玻璃拱顶的大市场。"""
    root, m = empty('market'), mats()
    L = level
    ground(root, 2, pbr('cobble', 'concrete_floor', 1.2, tint=(1.0, 0.9, 0.75)))
    colors = [(0.75, 0.15, 0.1), (0.9, 0.7, 0.1), (0.15, 0.5, 0.25), (0.15, 0.35, 0.75), (0.8, 0.35, 0.6), (0.95, 0.45, 0.1)]
    produce = [(0.85, 0.4, 0.05), (0.75, 0.1, 0.08), (0.4, 0.6, 0.12), (0.9, 0.8, 0.2)]
    if L >= 3:  # 后排店面
        floors = 1 if L == 3 else 2
        h = 0.45 * floors
        box((1.7, 0.55, h), (0, 0.6, h / 2 + 0.04), m['brick'], bevel=0.01, parent=root)
        box((1.8, 0.65, 0.05), (0, 0.6, h + 0.07), m['concrete'], parent=root)
        for k in range(3):
            box((0.4, 0.02, 0.3), (-0.55 + k * 0.55, 0.32, 0.22), m['glass'], parent=root)
            box((0.48, 0.2, 0.02), (-0.55 + k * 0.55, 0.24, 0.43), flat(f'awn{k}', colors[k], rough=0.8), rot=(math.radians(-20), 0, 0), parent=root)
        if L >= 4:
            windows_y(root, -0.8, 0.8, 0.32, (0.72,), m['glass'], 5, w=0.2, h=0.18)
            sign(root, 0, 0.31, h - 0.05, 0.9, 0.16, (0.85, 0.12, 0.1))
    if L >= 5:  # 玻璃拱顶大市场
        arch(root, 0.0, -0.35, 1.7, 0.55, flat('glassroof', (0.55, 0.7, 0.75), rough=0.1, metal=0.3), along='x')
        for k in range(5):
            x = -0.8 + k * 0.4
            box((0.04, 1.1, 0.04), (x, -0.35, 0.55), m['steel'], parent=root)
    stalls = {1: 2, 2: 4, 3: 4, 4: 5, 5: 4}[L]
    spots = [(-0.5, -0.25), (0.25, -0.25), (-0.5, -0.75), (0.25, -0.75), (0.75, 0.0)]
    for i in range(stalls):
        x, y = spots[i]
        if L >= 5:
            y -= 0.0
        box((0.42, 0.26, 0.18), (x, y, 0.13), m['planks'], parent=root)
        for c in (-1, 1):
            for d in (-1, 1):
                cyl(0.012, 0.4, (x + c * 0.19, y + d * 0.12, 0.24), m['pipe'], verts=6, parent=root)
        if L < 5:
            box((0.5, 0.34, 0.02), (x, y, 0.45), flat(f'canopy{i}', colors[i % len(colors)], rough=0.85), rot=(math.radians(-8), 0, 0), parent=root)
        for k in range(4):
            sphere(0.035, (x - 0.12 + k * 0.08, y - 0.03, 0.25), flat(f'prod{i}', produce[i % 4], rough=0.6), parent=root)
    crates(root, 0.75, -0.75, 2 + L, m['planks'], 0.14)
    return root


def farm(team, level=1):
    """农场：麦田和菜地，后角红谷仓。几级就多一片地；2 级起有筒仓（3 级两座），4 级加温室，5 级加风车。"""
    root, m = empty('farm'), mats()
    L = level
    box((2.9, 2.9, 0.04), (0, 0, 0.02), m['dirt'], parent=root)
    crops = [flat('wheat', (0.75, 0.6, 0.2), rough=0.9), flat('greens', (0.18, 0.4, 0.1), rough=0.9), flat('corn', (0.35, 0.5, 0.12), rough=0.9)]
    rows = 4 + L
    for i in range(rows):
        box((1.6, 0.14, 0.1), (-0.55, -1.25 + i * 0.22, 0.08), crops[(i // 3) % 3], bevel=0.04, parent=root)
    barn_s = 0.8 + 0.08 * L
    barn = pbr('barn', 'planks', 1.5, tint=(1.0, 0.35, 0.28))
    box((barn_s, barn_s * 1.2, 0.5 + 0.05 * L), (0.85, 0.75, (0.5 + 0.05 * L) / 2 + 0.04), barn, parent=root)
    gable(root, 0.85, 0.75, barn_s * 1.3, barn_s + 0.12, 0.38, 0.54 + 0.05 * L, m['corrugated'], along='y')
    box((0.02, 0.4, 0.4), (0.85 + barn_s / 2 + 0.01, 0.6, 0.24), flat('barndoor', (0.9, 0.88, 0.82), rough=0.7), parent=root)
    nsilo = {1: 0, 2: 1, 3: 2, 4: 2, 5: 3}[L]
    for k in range(nsilo):
        x, y = 1.1 - k * 0.45, -0.25
        cyl(0.2, 1.1 + 0.1 * k, (x, y, (1.1 + 0.1 * k) / 2 + 0.04), m['corrugated'], verts=28, parent=root)
        sphere(0.2, (x, y, 1.14 + 0.1 * k), m['steel'], scale=(1, 1, 0.6), parent=root)
    if L >= 4:  # 温室
        for k in range(L - 3):
            arch(root, -0.55, 1.15 - k * 0.0, 1.6, 0.28, flat('greenhouse', (0.75, 0.85, 0.85), rough=0.05, metal=0.2), along='x')
    if L >= 5:  # 风车
        cyl(0.04, 1.6, (1.15, -1.15, 0.8), m['white'], verts=10, parent=root)
        for k in range(3):
            a = k * 2 * math.pi / 3
            rod((1.12, -1.2, 1.6), (1.12, -1.2 + math.cos(a) * 0.45, 1.6 + math.sin(a) * 0.45), 0.02, m['white'], root)
    hay = flat('hay', (0.75, 0.62, 0.3), rough=0.95)
    for k in range(min(L + 1, 4)):
        cyl(0.11, 0.15, (0.3 + k * 0.25, -1.15, 0.12), hay, rot=(math.radians(90), 0, 0), verts=16, parent=root)
    return root


def _cooling_tower(root, x, y, r, h, m):
    prof = [(r, 0), (r * 0.82, h * 0.35), (r * 0.66, h * 0.7), (r * 0.68, h * 0.9), (r * 0.72, h)]
    lathe(root, prof, x, y, pbr('ctower', 'concrete', 1.5, tint=(0.95, 0.93, 0.9)), verts=36, z0=0.04)
    for k in range(10):  # 底部支柱
        a = k * 2 * math.pi / 10
        cyl(0.02, 0.1, (x + math.cos(a) * r * 0.97, y + math.sin(a) * r * 0.97, 0.05), m['concrete'], verts=6, parent=root)
    steam(root, x, y, h + 0.15, r * 1.6)


def power_plant(team, level=1):
    """发电厂：1 级柴油发电机房和小烟囱；2 级汽轮机房、红白烟囱；3 级加一座冷却塔（冒白汽）；
    4 级冷却塔更高、加变压器场；5 级两座冷却塔和高压电塔。"""
    root, m = empty('powerPlant'), mats()
    L = level
    pad(root, 2, m['pad'])
    hall_m = pbr('turb', 'corrugated', 1.5, tint=(0.55, 0.62, 0.72), metal=0.3)
    if L == 1:
        box((0.8, 0.55, 0.42), (0.1, -0.25, 0.25), hall_m, parent=root)
        cyl(0.05, 0.75, (0.35, 0.0, 0.4), m['rust'], verts=12, parent=root)
        box((0.3, 0.2, 0.2), (-0.5, -0.5, 0.15), m['olive'], parent=root)
        cyl(0.1, 0.35, (-0.5, 0.45, 0.2), flat('dieseltank', (0.75, 0.6, 0.15), rough=0.5), rot=(0, math.radians(90), 0), verts=16, parent=root)
    else:
        box((1.0, 0.6, 0.55), (0.3, -0.45, 0.33), hall_m, parent=root)
        box((1.05, 0.65, 0.05), (0.3, -0.45, 0.63), m['concrete'], parent=root)
        windows_y(root, -0.15, 0.75, -0.755, (0.45,), m['glass'], 4, w=0.16, h=0.1)
        chimney(root, 0.75, 0.0, 1.3 + 0.15 * L, 0.07)
    if L >= 3:
        _cooling_tower(root, -0.35, 0.35, 0.45 + 0.05 * (L - 3), 0.9 + 0.25 * (L - 3), m)
    if L >= 5:
        _cooling_tower(root, 0.35, 0.65, 0.3, 0.75, m)
    if L >= 4:  # 变压器场
        for k in range(3):
            x = -0.75 + k * 0.25
            box((0.18, 0.16, 0.2), (x, -0.55, 0.16), m['olive'], bevel=0.01, parent=root)
            for d in (-1, 1):
                cyl(0.012, 0.12, (x + d * 0.05, -0.55, 0.32), m['white'], verts=8, parent=root)
    if L >= 5:  # 高压电塔
        for s in (-1, 1):
            rod((-0.85 + s * 0.08, -0.9, 0.04), (-0.85, -0.9, 1.1), 0.015, m['steel'], root)
        box((0.45, 0.03, 0.03), (-0.85, -0.9, 1.0), m['steel'], parent=root)
    return root


def granary(team, level=1):
    """粮仓：金黄色顶的铁皮筒仓，几级就有几座（越往后越高）；3 级起有提升塔和输送管，5 级加卸粮卡车。"""
    root, m = empty('granary'), mats()
    L = level
    pad(root, 2, m['pad'])
    cap = flat('silocap', (0.85, 0.62, 0.15), rough=0.4, metal=0.5)
    spots = [(-0.45, 0.45), (0.2, 0.55), (-0.5, -0.2), (0.5, 0.05), (-0.05, -0.05)]
    for k in range(L):
        x, y = spots[k]
        h = 0.8 + 0.1 * L
        cyl(0.27, h, (x, y, h / 2 + 0.05), m['corrugated'], verts=32, parent=root)
        cone(0.28, 0.04, 0.2, (x, y, h + 0.15), cap, parent=root)
        cyl(0.275, 0.04, (x, y, h * 0.5), cap, verts=32, parent=root)  # 色带
    if L >= 3:
        th = 1.3 + 0.12 * L
        box((0.2, 0.2, th), (0.6, -0.55, th / 2 + 0.05), m['rust'], parent=root)
        box((0.28, 0.28, 0.18), (0.6, -0.55, th + 0.12), m['corrugated'], parent=root)
        for k in range(min(L, 3)):
            x, y = spots[k]
            rod((0.6, -0.55, th), (x, y, 0.8 + 0.1 * L + 0.2), 0.035, m['pipe'], root)
    if L >= 5:
        box((0.45, 0.25, 0.18), (0.55, -0.9, 0.14), flat('truck', (0.35, 0.38, 0.2), rough=0.7), bevel=0.02, parent=root)
    sign(root, -0.5, -0.9, 0.15, 0.35, 0.12, (0.85, 0.62, 0.15))
    return root


def vault(team, level=1):
    """金库：深色石头库房，正面金色圆形保险门。2 级加岗亭和铁栅栏，3 级换成带柱子的银行门脸，4 级加高、门口押运车，5 级四角碉楼的堡垒、金顶。"""
    root, m = empty('vault'), mats()
    L = level
    pad(root, 2, m['pad'])
    stone = pbr('vaultstone', 'concrete', 1.2, tint=(0.55, 0.53, 0.5))
    gold = flat('gold', (0.95, 0.68, 0.18), rough=0.22, metal=1.0)
    h = 0.5 + 0.12 * L
    w = 1.0 + 0.1 * min(L, 4)
    box((w, w * 0.8, h), (-0.1, 0.2, h / 2 + 0.05), stone, bevel=0.04, parent=root)
    box((w + 0.1, w * 0.8 + 0.1, 0.07), (-0.1, 0.2, h + 0.08), m['concrete'], parent=root)
    fy = 0.2 - w * 0.4 - 0.01
    cyl(0.22, 0.05, (-0.1, fy, 0.3), m['steel'], rot=(math.radians(90), 0, 0), verts=32, parent=root)
    cyl(0.16, 0.07, (-0.1, fy - 0.01, 0.3), gold, rot=(math.radians(90), 0, 0), verts=32, parent=root)
    box((w + 0.02, 0.03, 0.05), (-0.1, fy, h - 0.05), gold, parent=root)  # 金色檐口
    if L >= 2:  # 岗亭、栅栏
        box((0.22, 0.22, 0.38), (0.7, -0.7, 0.24), m['concrete'], parent=root)
        box((0.24, 0.24, 0.03), (0.7, -0.7, 0.44), m['dark'], parent=root)
        for k in range(8):
            cyl(0.01, 0.25, (-0.9 + k * 0.2, -0.92, 0.15), m['gun'], verts=6, parent=root)
        box((1.5, 0.015, 0.02), (-0.2, -0.92, 0.25), m['gun'], parent=root)
    if L >= 3:  # 柱子门脸
        for k in range(4):
            cyl(0.04, h - 0.1, (-0.1 - 0.4 + k * 0.27, fy - 0.15, h / 2), m['white'], verts=12, parent=root)
        box((0.95, 0.25, 0.06), (-0.1, fy - 0.1, h - 0.02), m['concrete'], parent=root)
    if L >= 4:  # 押运车
        box((0.4, 0.22, 0.2), (0.55, -0.25, 0.16), flat('armored', (0.2, 0.24, 0.2), rough=0.6, metal=0.4), bevel=0.03, parent=root)
    if L >= 5:  # 四角碉楼、金顶
        for sx in (-1, 1):
            for sy in (-1, 1):
                x, y = -0.1 + sx * w / 2, 0.2 + sy * w * 0.4
                prism(0.12, h + 0.25, (x, y, (h + 0.25) / 2 + 0.05), stone, 8, parent=root)
                cone(0.14, 0.0, 0.15, (x, y, h + 0.37), gold, verts=8, parent=root)
        sphere(0.25, (-0.1, 0.2, h + 0.12), gold, scale=(1, 1, 0.5), parent=root)
    return root


def lab(team, level=1):
    """研究所：白楼蓝玻璃带窗。2 级加卫星天线，3 级加天文台圆顶，4 级楼加高、两面天线，5 级加一面大射电望远镜。"""
    root, m = empty('lab'), mats()
    L = level
    pad(root, 2, m['pad'])
    blue = flat('labglass', (0.1, 0.3, 0.55), rough=0.05, metal=0.5)
    floors = 2 if L < 4 else 3
    h = floors * 0.3
    box((1.1, 0.8, h), (-0.25, 0.3, h / 2 + 0.05), m['white'], bevel=0.02, parent=root)
    for k in range(floors):
        z = 0.22 + k * 0.3
        box((1.06, 0.02, 0.1), (-0.25, -0.105, z), blue, parent=root)
        box((0.02, 0.76, 0.1), (0.305, 0.3, z), blue, parent=root)
    box((1.15, 0.85, 0.04), (-0.25, 0.3, h + 0.07), m['concrete'], parent=root)
    cyl(0.012, 0.45, (-0.7, 0.6, h + 0.3), m['pipe'], verts=6, parent=root)

    def dish(x, y, r, z):
        cyl(0.03, z, (x, y, z / 2), m['pipe'], verts=10, parent=root)
        d = sphere(r, (x, y, z + r * 0.2), m['white'], scale=(1, 1, 0.28), parent=root)
        d.rotation_euler = (math.radians(35), math.radians(-30), 0)
        rod((x, y, z + r * 0.2), (x - r * 0.3, y + r * 0.35, z + r * 0.75), 0.01, m['pipe'], root)
    if L >= 2:
        dish(0.6, -0.55, 0.22, 0.3)
    if L >= 3:  # 天文台圆顶
        cyl(0.22, 0.1, (-0.5, 0.45, h + 0.14), m['white'], verts=32, parent=root)
        sphere(0.22, (-0.5, 0.45, h + 0.19), m['white'], scale=(1, 1, 0.9), parent=root)
        box((0.07, 0.25, 0.18), (-0.5, 0.33, h + 0.33), m['dark'], rot=(math.radians(-35), 0, 0), parent=root)
    if L >= 4:
        dish(0.65, 0.2, 0.18, 0.25)
    if L >= 5:  # 大射电望远镜
        for s in (-1, 1):
            rod((0.45 + s * 0.12, 0.7, 0.04), (0.45, 0.7, 0.75), 0.03, m['steel'], root)
        big = sphere(0.55, (0.45, 0.7, 0.95), m['white'], scale=(1, 1, 0.22), parent=root)
        big.rotation_euler = (math.radians(30), math.radians(-25), 0)
        rod((0.45, 0.7, 0.95), (0.3, 0.85, 1.4), 0.015, m['pipe'], root)
    tree(root, -0.85, -0.65, 0.6)
    return root


# ---------- 资源 ----------

def _log_pile(root, x, y, n, m, along='x', length=0.8):
    rows = 1 if n <= 3 else 2 if n <= 6 else 3
    k = 0
    for row in range(rows):
        for i in range(4 - row):
            if k >= n:
                return
            off = -0.23 + i * 0.15 + row * 0.075
            loc = (x, y + off, 0.1 + row * 0.13) if along == 'x' else (x + off, y, 0.1 + row * 0.13)
            rot = (0, math.radians(90), 0) if along == 'x' else (math.radians(90), 0, 0)
            cyl(0.075, length, loc, m['bark'], rot=rot, verts=12, parent=root)
            k += 1


def lumber_mill(team, level=1):
    """伐木场：原木堆和锯木台。2 级加木头敞棚，3 级换成带烟囱的锯木厂房，4 级加龙门吊，5 级加板材堆和烘干窑。原木堆随等级变多。"""
    root, m = empty('lumberMill'), mats()
    L = level
    ground(root, 2, pbr('sawdust_ground', 'dirt', 0.8, tint=(1.1, 0.95, 0.75)))
    if L == 1:
        box((0.6, 0.25, 0.18), (-0.3, 0.35, 0.13), m['steel'], parent=root)
        cyl(0.13, 0.01, (-0.3, 0.35, 0.27), m['pipe'], rot=(math.radians(90), 0, 0), verts=24, parent=root)
    elif L == 2:
        for x in (-0.75, 0.15):
            for y in (0.05, 0.75):
                box((0.07, 0.07, 0.55), (x, y, 0.3), m['planks'], parent=root)
        gable(root, -0.3, 0.4, 1.15, 0.95, 0.25, 0.57, m['corrugated'])
        box((0.6, 0.25, 0.18), (-0.3, 0.4, 0.13), m['steel'], parent=root)
    else:
        mill = pbr('millwood', 'planks', 1.5, tint=(0.75, 0.55, 0.38))
        box((1.1, 0.8, 0.6), (-0.35, 0.45, 0.34), mill, parent=root)
        gable(root, -0.35, 0.45, 1.2, 0.9, 0.3, 0.64, m['corrugated'])
        box((0.02, 0.4, 0.35), (0.205, 0.45, 0.22), m['dark'], parent=root)
        chimney(root, -0.75, 0.75, 1.3, 0.05, m['rust'])
    if L >= 4:  # 龙门吊
        for y in (-0.85, -0.05):
            for x in (-0.85, 0.85):
                rod((x, y, 0.04), (x, y, 0.95), 0.025, m['yellow'], root)
            rod((-0.85, y, 0.95), (0.85, y, 0.95), 0.03, m['yellow'], root)
        box((0.15, 0.85, 0.08), (0.2, -0.45, 0.95), m['yellow'], parent=root)
    if L >= 5:  # 板材、烘干窑
        for k in range(3):
            box((0.5, 0.25, 0.05), (0.6, 0.6, 0.07 + k * 0.06), pbr('planks2', 'planks', 2.0, tint=(1.2, 1.05, 0.8)), parent=root)
        box((0.4, 0.35, 0.35), (0.6, 0.15, 0.22), m['brick'], parent=root)
    _log_pile(root, 0.05, -0.5, 3 + 2 * L if L < 4 else 9, m)
    if L >= 2:
        _log_pile(root, 0.7, -0.1, min(3 + L, 9), m, along='y', length=0.6)
    cone(0.15 + 0.03 * L, 0.0, 0.12 + 0.03 * L, (-0.7, -0.7, 0.1), flat('sawdust', (0.7, 0.52, 0.3), rough=1), parent=root)
    return root


def quarry(team, level=1):
    """采石场：一层层切出来的石台阶，几级就几层（越来越高）；3 级起有碎石机，4 级加起重吊杆，5 级加传送带和碎石堆。"""
    root, m = empty('quarry'), mats()
    L = level
    ground(root, 2, m['dirt'])
    rockm = pbr('quarryrock', 'concrete', 1.2, tint=(0.72, 0.7, 0.66))
    tiers = min(L + 1, 5)
    for k in range(tiers):
        s = 1.5 - k * 0.25
        box((s, s, 0.25), (-0.25 + k * 0.06, 0.25 + k * 0.06, 0.12 + k * 0.25), rockm, bevel=0.03, parent=root)
    stone = pbr('stone', 'concrete', 2.0, tint=(0.8, 0.78, 0.74))
    nblocks = 2 + L
    for i in range(nblocks):
        x, y = -0.75 + (i % 4) * 0.22, -0.65 + (i // 4) * 0.22
        box((0.18, 0.18, 0.15), (x, y, 0.12), stone, bevel=0.02, parent=root)
    if L >= 3:  # 碎石机
        box((0.32, 0.32, 0.35), (0.6, -0.4, 0.22), m['yellow'], parent=root)
        box((0.36, 0.36, 0.06), (0.6, -0.4, 0.43), m['rust'], parent=root)
    if L >= 4:  # 吊杆
        cyl(0.04, 1.2, (0.55, 0.55, 0.62), m['rust'], verts=10, parent=root)
        rod((0.55, 0.55, 1.1), (-0.1, 0.1, 1.45), 0.025, m['rust'], root)
        cyl(0.005, 0.5, (-0.1, 0.1, 1.2), m['pipe'], verts=4, parent=root)
    if L >= 5:  # 传送带和碎石堆
        box((0.08, 0.7, 0.04), (0.6, -0.85, 0.35), m['dark'], rot=(math.radians(25), 0, 0), parent=root)
        cone(0.28, 0.0, 0.3, (0.85, -0.85, 0.17), rockm, parent=root)
    return root


def _headframe(root, x, y, h, m, steel=True):
    beam = m['rust'] if steel else m['planks']
    top = (x, y, h)
    for dx, dy in [(-0.2, -0.2), (0.2, -0.2), (-0.2, 0.2), (0.2, 0.2)]:
        rod((x + dx, y + dy, 0.04), (top[0] + dx * 0.3, top[1] + dy * 0.3, top[2]), 0.03, beam, root)
    rod((x + 0.6, y - 0.3, 0.04), (x + 0.05, y, h - 0.1), 0.035, beam, root)
    for z in (h * 0.35, h * 0.7):
        box((0.36, 0.36, 0.025), (x, y, z), beam, parent=root)
    cyl(0.17, 0.04, (x, y, h + 0.1), m['gun'], rot=(math.radians(90), 0, math.radians(45)), verts=24, parent=root)


def mine(team, level=1):
    """矿井：1 级木井架和矿石堆；2 级钢井架加卷扬机房；3 级加矿车轨道；4 级井架更高、加矿仓和传送带；5 级两座井架。"""
    root, m = empty('mine'), mats()
    L = level
    ground(root, 2, pbr('minedirt', 'laterite', 1.0, tint=(0.9, 0.8, 0.75)))
    _headframe(root, -0.3, 0.3, 0.8 + 0.25 * L, m, steel=L >= 2)
    if L >= 2:  # 卷扬机房
        box((0.5, 0.45, 0.4), (0.5, 0.5, 0.24), m['corr_green'], parent=root)
        gable(root, 0.5, 0.5, 0.55, 0.5, 0.15, 0.44, m['rust'])
    if L >= 3:  # 轨道和矿车
        for k in range(2):
            box((1.4, 0.03, 0.02), (0.0, -0.8 + k * 0.14, 0.05), m['pipe'], parent=root)
        for x in (-0.35, 0.15):
            box((0.25, 0.16, 0.12), (x, -0.73, 0.12), m['rust'], parent=root)
    if L >= 4:  # 矿仓、传送带
        box((0.35, 0.35, 0.4), (0.6, -0.3, 0.55), m['rust'], parent=root)
        for dx in (-0.12, 0.12):
            for dy in (-0.12, 0.12):
                cyl(0.02, 0.35, (0.6 + dx, -0.3 + dy, 0.2), m['steel'], verts=6, parent=root)
        rod((-0.2, 0.15, 0.6), (0.5, -0.25, 0.75), 0.04, m['dark'], root)
    if L >= 5:
        _headframe(root, 0.45, 0.65, 1.2, m)
    cone(0.22 + 0.04 * L, 0.0, 0.2 + 0.04 * L, (0.55, -0.7 if L < 3 else 0.0, 0.14), pbr('ore', 'laterite', 1.0, tint=(0.8, 0.45, 0.35)), parent=root)
    return root


def _pumpjack(root, x, y, m, s=1.0):
    paint = flat('pumpjack', (0.12, 0.25, 0.42), rough=0.5, metal=0.4)
    box((0.85 * s, 0.25 * s, 0.06), (x, y, 0.07), m['concrete'], parent=root)
    for sy in (-1, 1):
        rod((x - 0.1 * s, y + sy * 0.1 * s, 0.1), (x, y, 0.62 * s), 0.025, paint, root)
        rod((x + 0.15 * s, y + sy * 0.1 * s, 0.1), (x, y, 0.62 * s), 0.025, paint, root)
    box((0.8 * s, 0.06, 0.06), (x + 0.05 * s, y, 0.65 * s), paint, rot=(0, math.radians(-12), 0), parent=root)
    box((0.07, 0.09, 0.26 * s), (x + 0.45 * s, y, 0.62 * s), paint, rot=(0, math.radians(-12), 0), parent=root)
    box((0.2 * s, 0.17 * s, 0.15 * s), (x - 0.38 * s, y, 0.35 * s), m['yellow'], parent=root)
    cyl(0.018, 0.35 * s, (x + 0.48 * s, y, 0.28 * s), m['pipe'], verts=8, parent=root)


def oil_well(team, level=1):
    """油井：黑泥地上的磕头机。1–2 级一台，3–4 级两台，5 级三台加一座钻塔；2 级起有储油罐（4 级两个）和管线。"""
    root, m = empty('oilWell'), mats()
    L = level
    ground(root, 2, m['mud'])
    pumps = {1: 1, 2: 1, 3: 2, 4: 2, 5: 3}[L]
    for k, (x, y) in enumerate([(-0.15, -0.35), (-0.3, 0.35), (0.45, -0.75)][:pumps]):
        _pumpjack(root, x, y, m, 0.85 if k else 1.0)
    ntank = {1: 0, 2: 1, 3: 1, 4: 2, 5: 2}[L]
    for k in range(ntank):
        tank_storage(root, 0.6, 0.55 - k * 0.6, 0.22, 0.45, m['steel'])
        rod((0.35, -0.35, 0.08), (0.6, 0.55 - k * 0.6, 0.08), 0.02, m['pipe'], root)
    if L >= 5:  # 钻塔
        for dx, dy in [(-0.15, -0.15), (0.15, -0.15), (-0.15, 0.15), (0.15, 0.15)]:
            rod((-0.65 + dx, 0.65 + dy, 0.04), (-0.65 + dx * 0.2, 0.65 + dy * 0.2, 1.6), 0.02, m['rust'], root)
        for z in (0.5, 1.0):
            box((0.24 - z * 0.08, 0.24 - z * 0.08, 0.02), (-0.65, 0.65, z), m['rust'], parent=root)
    if L == 1:
        box((0.25, 0.2, 0.2), (0.5, 0.4, 0.14), m['olive'], parent=root)
    return root


# ---------- 工业 ----------

def arsenal(team, level=1):
    """兵工厂：红砖锯齿屋顶的车间，等级越高锯齿越多（2–6 跨，厂房越来越长）；3 级加烟囱，4 级右边院子里炮弹堆，5 级加吊车和装甲车。"""
    root, m = empty('arsenal'), mats()
    L = level
    pad(root, 3, m['pad'])
    bays = L + 1
    depth = min(0.38, 2.1 / bays)
    y0 = 1.0 - bays * depth
    box((2.1, bays * depth, 0.6), (-0.2, 1.0 - bays * depth / 2, 0.36), pbr('redbrick', 'brick', 1.5, tint=(1.1, 0.75, 0.7)), parent=root)
    for k in range(bays):
        y = y0 + k * depth
        extrude('saw', [(y, 0.66), (y + depth, 0.66), (y + depth, 0.92)], 'x', -1.25, 0.85, m['corrugated'], root)
        box((2.1, 0.01, 0.22), (-0.2, y + depth - 0.005, 0.79), m['glass'], parent=root)
    box((0.02, min(0.5, bays * depth - 0.1), 0.45), (0.86, 1.0 - bays * depth / 2, 0.29), m['shutter'], parent=root)
    windows_y(root, -1.1, 0.7, y0 - 0.005, (0.4,), m['glass'], 5, w=0.18, h=0.16)
    sign(root, -0.2, y0 - 0.01, 0.58, 0.6, 0.1, (0.65, 0.1, 0.08))
    if L >= 3:
        chimney(root, -1.15, 1.15, 1.4, 0.07, m['brick'])
    # 厂房右边（+x）的院子：弹药箱、炮弹、吊车
    crates(root, 1.15, -0.9, 2 + L, m['green'], 0.18)
    if L >= 4:
        brass = flat('brass', (0.75, 0.55, 0.2), rough=0.3, metal=0.9)
        for k in range(6):
            cyl(0.04, 0.22, (1.1, -0.2 + k * 0.09, 0.17), brass, verts=12, parent=root)
            cone(0.04, 0.0, 0.08, (1.1, -0.2 + k * 0.09, 0.32), m['gun'], verts=12, parent=root)
    if L >= 5:
        for y in (-1.3, 0.9):
            rod((1.35, y, 0.04), (1.35, y, 1.0), 0.03, m['yellow'], root)
        rod((1.35, -1.3, 1.0), (1.35, 0.9, 1.0), 0.04, m['yellow'], root)
        box((0.25, 0.45, 0.2), (1.1, 0.55, 0.17), m['olive'], bevel=0.03, parent=root)
    return root


def electronics_plant(team, level=1):
    """电子厂：白色洁净厂房配蓝色玻璃楼。2 级屋顶加空调机组，3 级玻璃楼加到两层半，4 级加第二座厂房和太阳能板，5 级加一座高玻璃塔楼。"""
    root, m = empty('electronicsPlant'), mats()
    L = level
    pad(root, 3, m['pad'])
    blue = flat('blueglass', (0.08, 0.25, 0.45), rough=0.05, metal=0.6)
    box((1.5, 1.1, 0.5), (-0.4, 0.5, 0.3), m['white'], bevel=0.02, parent=root)
    box((1.55, 1.15, 0.04), (-0.4, 0.5, 0.57), m['concrete'], parent=root)
    windows_y(root, -1.1, 0.3, -0.055, (0.32,), blue, 4, w=0.22, h=0.16)
    gh = 0.6 + 0.2 * min(L, 3)
    box((0.8, 0.65, gh), (0.6, -0.35, gh / 2 + 0.05), blue, bevel=0.01, parent=root)
    box((0.85, 0.7, 0.04), (0.6, -0.35, gh + 0.07), m['white'], parent=root)
    for k in range(int(gh / 0.28)):
        box((0.82, 0.67, 0.012), (0.6, -0.35, 0.3 + k * 0.28), m['white'], parent=root)
    sign(root, 0.6, -0.69, gh - 0.1, 0.5, 0.1, (0.1, 0.55, 0.85))
    if L >= 2:
        for i in range(2 + L):
            box((0.2, 0.16, 0.11), (-1.0 + i * 0.25, 0.8, 0.65), m['steel'], parent=root)
            cyl(0.06, 0.02, (-1.0 + i * 0.25, 0.8, 0.71), m['dark'], verts=16, parent=root)
    if L >= 4:
        box((0.9, 0.7, 0.4), (-0.75, -0.65, 0.25), m['white'], bevel=0.02, parent=root)
        panel = flat('solar', (0.05, 0.08, 0.2), rough=0.1, metal=0.5)
        for i in range(3):
            box((0.25, 0.5, 0.02), (-1.0 + i * 0.27, -0.65, 0.5), panel, rot=(0, math.radians(-20), 0), parent=root)
    if L >= 5:  # 塔楼
        box((0.5, 0.5, 1.6), (-0.95, 1.0, 0.85), blue, bevel=0.01, parent=root)
        for k in range(6):
            box((0.52, 0.52, 0.012), (-0.95, 1.0, 0.3 + k * 0.25), m['white'], parent=root)
        cyl(0.012, 0.4, (-0.95, 1.0, 1.85), m['pipe'], verts=6, parent=root)
    tree(root, 1.15, 0.7, 0.7)
    return root


# ---------- 仓储 ----------

CONTAINER_COLORS = [(0.7, 0.15, 0.1), (0.12, 0.35, 0.65), (0.15, 0.5, 0.3), (0.85, 0.55, 0.1), (0.5, 0.5, 0.52)]


def _container(root, x, y, z, k, rot=0.0):
    c = pbr(f'cont{k}', 'corrugated', 2.0, tint=CONTAINER_COLORS[k % len(CONTAINER_COLORS)], rough=0.5, metal=0.3)
    box((0.55, 0.22, 0.22), (x, y, z + 0.11), c, rot=(0, 0, rot), parent=root)


def warehouse(team, level=1):
    """物资仓库：绿色铁皮库房和卷帘门。库房随等级变大；3 级起门口码彩色集装箱（越堆越高），4 级加叉车，5 级加门式起重机。"""
    root, m = empty('warehouse'), mats()
    L = level
    pad(root, 2, m['asphalt'])
    w = 0.9 + 0.15 * min(L, 4)
    h = 0.4 + 0.05 * L
    box((w, 0.8, h), (-0.2, 0.45, h / 2 + 0.04), m['corr_green'], parent=root)
    gable(root, -0.2, 0.45, w + 0.1, 0.9, 0.2, h + 0.04, m['corrugated'])
    for k in range(1 + (L >= 3)):
        box((0.35, 0.02, 0.3), (-0.45 + k * 0.5, 0.045, 0.2), m['shutter'], parent=root)
    box((0.6, 0.1, 0.02), (-0.2, -0.2, 0.065), m['yellow'], parent=root)
    if L <= 2:
        crates(root, 0.5, -0.6, 2 + 2 * L, m['planks'], 0.17)
    else:
        stacks = {3: [1, 1], 4: [2, 1, 1], 5: [3, 2, 2]}[L]
        k = 0
        for i, hgt in enumerate(stacks):
            for j in range(hgt):
                _container(root, 0.35, -0.75 + i * 0.27, j * 0.22, k)
                k += 1
    if L >= 4:  # 叉车
        box((0.2, 0.14, 0.12), (-0.55, -0.6, 0.1), m['yellow'], bevel=0.02, parent=root)
        box((0.02, 0.12, 0.25), (-0.44, -0.6, 0.16), m['dark'], parent=root)
    if L >= 5:  # 门式起重机
        for x in (-0.05, 0.75):
            for y in (-0.95, -0.05):
                rod((x, y, 0.04), (x, y, 0.95), 0.025, m['red'], root)
            rod((x, -0.95, 0.95), (x, -0.05, 0.95), 0.03, m['red'], root)
        box((0.85, 0.08, 0.06), (0.35, -0.5, 0.95), m['red'], parent=root)
    return root


def oil_depot(team, level=1):
    """油罐：白色立式储罐带红色色带，几级就有几座（5 级四座大罐加泵房），外面一圈防火堤。"""
    root, m = empty('oilDepot'), mats()
    L = level
    pad(root, 2, m['concrete'])
    for s in (-1, 1):
        box((0.05, 1.85, 0.14), (s * 0.92, 0, 0.11), m['concrete'], parent=root)
        box((1.85, 0.05, 0.14), (0, s * 0.92, 0.11), m['concrete'], parent=root)
    layouts = {1: [(-0.15, 0.15, 0.5)], 2: [(-0.4, 0.35, 0.36), (0.35, -0.3, 0.36)],
               3: [(-0.42, 0.42, 0.33), (0.42, 0.42, 0.33), (-0.42, -0.42, 0.33)],
               4: [(-0.42, 0.42, 0.34), (0.42, 0.42, 0.34), (-0.42, -0.42, 0.34), (0.42, -0.42, 0.34)],
               5: [(-0.42, 0.42, 0.38), (0.42, 0.42, 0.38), (-0.42, -0.42, 0.38), (0.42, -0.42, 0.3)]}[L]
    stripe = flat('stripe', (0.7, 0.12, 0.1))
    for x, y, r in layouts:
        h = 0.45 + 0.08 * L
        tank_storage(root, x, y, r, h, m['white'], m['steel'])
        cyl(r + 0.01, 0.05, (x, y, h * 0.65), stripe, verts=32, parent=root)
        rod((x + r * 0.7, y - r * 0.7, 0.05), (x + r * 0.7, y - r * 0.7, h + 0.05), 0.012, m['pipe'], root)  # 扶梯
    if L >= 2:
        box((0.1, 1.2, 0.03), (0.0, 0.0, 0.25), m['pipe'], parent=root)
    if L >= 5:  # 泵房
        box((0.3, 0.25, 0.25), (0.62, -0.75, 0.17), m['corrugated'], parent=root)
    return root


def _bunker(root, x, y, L, m, s=1.0):
    arch(root, x - 0.05 * s, y, 0.9 * s, 0.45 * s, flat('turf', (0.16, 0.3, 0.08), rough=0.95), along='x')
    box((0.1, 0.95 * s, 0.42 * s), (x + 0.42 * s, y, 0.23 * s), m['concrete'], bevel=0.02, parent=root)
    box((0.02, 0.35 * s, 0.3 * s), (x + 0.48 * s, y, 0.17 * s), m['green'], parent=root)
    box((0.02, 0.14, 0.14), (x + 0.48 * s, y - 0.32 * s, 0.32 * s), m['yellow'], rot=(math.radians(45), 0, 0), parent=root)


def ammo_depot(team, level=1):
    """弹药库：覆土的拱形库（上面长草），混凝土门脸和黄色警示牌。1 级一座小库，2 级大一点加铁丝网，3 级两座，4 级加瞭望塔，5 级三座。"""
    root, m = empty('ammoDepot'), mats()
    L = level
    ground(root, 2, m['dirt'])
    if L == 1:
        _bunker(root, -0.2, 0.3, L, m, 0.85)
    elif L == 2:
        _bunker(root, -0.2, 0.25, L, m, 1.1)
    elif L in (3, 4):
        _bunker(root, -0.35, 0.5, L, m, 0.9)
        _bunker(root, 0.3, -0.25, L, m, 0.8)
    else:
        _bunker(root, -0.45, 0.55, L, m, 0.8)
        _bunker(root, 0.35, 0.45, L, m, 0.7)
        _bunker(root, -0.2, -0.35, L, m, 0.75)
    if L >= 2:  # 铁丝网
        for k in range(7):
            cyl(0.012, 0.22, (-0.9 + k * 0.3, -0.9, 0.12), m['pipe'], verts=6, parent=root)
        box((1.8, 0.01, 0.12), (0.0, -0.9, 0.16), flat('wire', (0.4, 0.4, 0.4), metal=0.7), parent=root)
    if L >= 4:  # 瞭望塔
        for dx in (-0.08, 0.08):
            for dy in (-0.08, 0.08):
                rod((0.75 + dx, 0.75 + dy, 0.04), (0.75 + dx * 0.7, 0.75 + dy * 0.7, 0.9), 0.015, m['planks'], root)
        box((0.25, 0.25, 0.12), (0.75, 0.75, 0.95), m['planks'], parent=root)
        box((0.3, 0.3, 0.03), (0.75, 0.75, 1.1), m['corrugated'], parent=root)
    crates(root, 0.6, -0.55, 1 + L, m['green'], 0.16)
    return root


# ---------- 财政 ----------

def _car(root, x, y, color, rot=0.0):
    m = mats()
    box((0.22, 0.11, 0.07), (x, y, 0.07), flat('car', color, rough=0.3, metal=0.5), bevel=0.02, rot=(0, 0, rot), parent=root)
    box((0.12, 0.1, 0.05), (x - 0.01, y, 0.125), m['glass'], bevel=0.015, rot=(0, 0, rot), parent=root)


def _office(root, x, y, w, d, floors, wall, glass, m, fh=0.28):
    """办公楼：一层层的墙和整面玻璃带窗。返回楼顶高度。"""
    h = floors * fh
    box((w, d, h), (x, y, h / 2 + 0.04), wall, bevel=0.012, parent=root)
    for k in range(floors):
        z = 0.04 + fh * (k + 0.55)
        box((w * 0.92, 0.012, fh * 0.5), (x, y - d / 2 - 0.004, z), glass, parent=root)
        box((0.012, d * 0.9, fh * 0.5), (x + w / 2 + 0.004, y, z), glass, parent=root)
    box((w + 0.04, d + 0.04, 0.04), (x, y, h + 0.06), m['concrete'], parent=root)
    return h + 0.08


def bank(team, level=1):
    """银行：深色花岗岩配金色。1 级一间带金币招牌的营业厅；之后每级加一层，3 级起门口两根金柱，
    4 级楼顶金色檐口，5 级成了花岗岩玻璃塔楼、顶上金冠。门口停着运钞车（2 级起）。"""
    root, m = empty('bank'), mats()
    L = level
    pad(root, 2, pbr('plazabank', 'concrete_floor', 0.8, tint=(0.75, 0.73, 0.7)))
    granite = pbr('granite', 'concrete', 1.2, tint=(0.38, 0.36, 0.38))
    gold = flat('gold', (0.95, 0.68, 0.18), rough=0.22, metal=1.0)
    glass = flat('bankglass', (0.08, 0.12, 0.16), rough=0.05, metal=0.6)
    if L < 5:
        h = _office(root, -0.2, 0.25, 1.1, 0.95, L + 1, granite, glass, m, fh=0.32)
    else:
        h = _office(root, -0.3, 0.35, 0.85, 0.8, 7, granite, glass, m, fh=0.3)
        cone(0.3, 0.05, 0.25, (-0.3, 0.35, h + 0.12), gold, verts=8, parent=root)
        box((0.95, 0.9, 0.12), (-0.3, 0.35, 0.1), granite, parent=root)
    fy = 0.25 - 0.475 - 0.01 if L < 5 else 0.35 - 0.4 - 0.01
    fx = -0.2 if L < 5 else -0.3
    # 金币招牌
    cyl(0.13, 0.03, (fx, fy - 0.01, min(h - 0.15, 0.55)), gold, rot=(math.radians(90), 0, 0), verts=32, parent=root)
    cyl(0.08, 0.035, (fx, fy - 0.015, min(h - 0.15, 0.55)), flat('coinin', (0.75, 0.5, 0.1), rough=0.3, metal=1.0), rot=(math.radians(90), 0, 0), verts=6, parent=root)
    if L >= 3:  # 金柱
        for dx in (-0.3, 0.3):
            cyl(0.04, 0.42, (fx + dx, fy - 0.12, 0.25), gold, verts=12, parent=root)
        box((0.8, 0.2, 0.05), (fx, fy - 0.1, 0.48), granite, parent=root)
    if L >= 4:
        box((1.16, 1.0, 0.04), (fx, 0.25 if L < 5 else 0.35, h - 0.01), gold, parent=root)
    if L >= 2:  # 运钞车
        box((0.32, 0.17, 0.17), (0.65, -0.55, 0.13), flat('vanbody', (0.55, 0.58, 0.6), rough=0.4, metal=0.5), bevel=0.03, parent=root)
        box((0.33, 0.175, 0.03), (0.65, -0.55, 0.16), flat('vanstripe', (0.1, 0.35, 0.2), rough=0.5), parent=root)
    return root


def private_enterprise(team, level=1):
    """私营企业：蓝色招牌的商用楼。1 级小作坊，2 级两间门面，3 级三层写字楼加广告牌，4 级再加停车场和车，5 级玻璃写字楼。"""
    root, m = empty('privateEnterprise'), mats()
    L = level
    pad(root, 2, m['asphalt'])
    teal = (0.1, 0.55, 0.8)
    wall = pbr('pewall', 'concrete', 1.0, tint=(1.15, 1.12, 1.08))
    glass = flat('peglass', (0.1, 0.3, 0.45), rough=0.05, metal=0.5)
    if L == 1:
        box((0.9, 0.7, 0.4), (-0.25, 0.3, 0.24), wall, bevel=0.01, parent=root)
        box((0.95, 0.75, 0.04), (-0.25, 0.3, 0.46), m['corrugated'], parent=root)
        box((0.4, 0.02, 0.28), (-0.35, -0.055, 0.18), m['shutter'], parent=root)
        sign(root, -0.25, -0.06, 0.4, 0.6, 0.08, teal)
    elif L == 2:
        for k, c in enumerate([teal, (0.95, 0.5, 0.1)]):
            x = -0.55 + k * 0.6
            box((0.55, 0.7, 0.5), (x, 0.3, 0.29), wall, bevel=0.01, parent=root)
            box((0.42, 0.02, 0.3), (x, -0.055, 0.2), glass, parent=root)
            sign(root, x, -0.065, 0.45, 0.45, 0.08, c)
    else:
        floors = 3 if L < 5 else 6
        h = _office(root, -0.3, 0.3, 1.0, 0.8, floors, wall if L < 5 else glass, glass, m)
        sign(root, -0.3, -0.11, h - 0.08, 0.6, 0.1, teal)
        if L >= 3 and L < 5:  # 楼顶广告牌
            for dx in (-0.25, 0.25):
                cyl(0.012, 0.25, (-0.3 + dx, 0.45, h + 0.12), m['steel'], verts=6, parent=root)
            box((0.7, 0.03, 0.25), (-0.3, 0.45, h + 0.32), flat('billboard', (0.95, 0.75, 0.15), rough=0.5), parent=root)
        if L >= 5:
            cyl(0.008, 0.35, (-0.45, 0.5, h + 0.17), m['pipe'], verts=4, parent=root)
            box((0.42, 0.02, 0.22), (-0.3, -0.11, 0.18), glass, parent=root)
    if L >= 4:  # 停车场
        for k in range(3):
            box((0.02, 0.18, 0.003), (0.35 + k * 0.25, -0.6, 0.065), m['white'], parent=root)
        _car(root, 0.48, -0.6, (0.7, 0.1, 0.08), math.radians(90))
        _car(root, 0.73, -0.6, (0.15, 0.2, 0.45), math.radians(90))
    tree(root, 0.7, 0.6, 0.6)
    return root


def state_enterprise(team, level=1):
    """国营企业：红顶米墙的大厂房，门口挂红色横幅。2 级加水塔，3 级加第二座厂房和烟囱，4 级加办公楼，5 级加总部大楼、楼顶红色招牌。"""
    root, m = empty('stateEnterprise'), mats()
    L = level
    pad(root, 3, m['pad'])
    cream = pbr('cream', 'concrete', 1.0, tint=(1.2, 1.1, 0.9))
    red_roof = pbr('redroof2', 'corrugated', 1.5, tint=(1.3, 0.45, 0.35), rough=0.5, metal=0.2)
    red = flat('banner', (0.75, 0.08, 0.06), rough=0.6)

    def hall_block(x, y, w, d, h):
        box((w, d, h), (x, y, h / 2 + 0.04), cream, bevel=0.01, parent=root)
        gable(root, x, y, w + 0.08, d + 0.08, 0.22, h + 0.04, red_roof)
        windows_y(root, x - w / 2 + 0.1, x + w / 2 - 0.1, y - d / 2 - 0.005, (h * 0.6,), m['glass'], int(w / 0.25), w=0.14, h=0.14)
        box((w * 0.7, 0.02, 0.1), (x, y - d / 2 - 0.012, h - 0.08), red, parent=root)  # 横幅
    hall_block(-0.3, 0.6, 1.8, 0.8, 0.55)
    box((0.02, 0.35, 0.35), (0.605, 0.6, 0.22), m['shutter'], parent=root)
    if L >= 2:  # 水塔
        for dx in (-0.08, 0.08):
            for dy in (-0.08, 0.08):
                rod((1.05 + dx, 1.05 + dy, 0.04), (1.05 + dx * 0.6, 1.05 + dy * 0.6, 0.8), 0.015, m['steel'], root)
        cyl(0.16, 0.25, (1.05, 1.05, 0.92), m['rust'], verts=20, parent=root)
        cone(0.17, 0.02, 0.1, (1.05, 1.05, 1.1), m['rust'], parent=root)
    if L >= 3:
        hall_block(-0.5, -0.35, 1.3, 0.65, 0.45)
        chimney(root, -1.15, 1.15, 1.5, 0.07, m['brick'])
    if L >= 4:  # 办公楼
        h = _office(root, 0.85, -0.25, 0.55, 0.6, 3, cream, m['glass'], m)
        box((0.4, 0.02, 0.12), (0.85, -0.565, h - 0.12), red, parent=root)
    if L >= 5:  # 总部大楼
        h = _office(root, 0.85, 0.3, 0.6, 0.5, 6, cream, m['glass'], m)
        box((0.5, 0.03, 0.18), (0.85, 0.04, h + 0.12), red, parent=root)
        cyl(0.012, 0.5, (1.05, 0.45, h + 0.25), m['pipe'], verts=6, parent=root)
    flag(root, 1.2, -1.15, team, 1.2)
    return root


def stock_exchange(team, level=1):
    """证券交易所：大柱廊的古典大厅，门脸上一条红绿闪烁的行情显示屏，门前一头铜牛。
    2 级加两翼，3 级屋顶加玻璃中庭，4 级后面加一座塔楼，5 级塔楼变成摩天楼、楼身绕着 LED 行情带。"""
    root, m = empty('stockExchange'), mats()
    L = level
    box((2.9, 2.9, 0.05), (0, 0, 0.025), pbr('plazaex', 'concrete_floor', 0.8, tint=(1.1, 1.05, 0.98)), bevel=0.02, parent=root)
    marble = pbr('marble2', 'concrete', 1.2, tint=(1.25, 1.22, 1.15))
    green = flat('tickg', (0.1, 1.0, 0.3), emission=4)
    redl = flat('tickr', (1.0, 0.15, 0.1), emission=4)
    h = 0.8
    box((1.6, 1.0, h), (-0.1, 0.35, h / 2 + 0.05), marble, bevel=0.02, parent=root)
    box((1.7, 1.1, 0.06), (-0.1, 0.35, h + 0.08), m['concrete'], parent=root)
    for k in range(6):  # 柱廊
        cyl(0.055, h - 0.08, (-0.75 + k * 0.26, -0.3, h / 2 + 0.01), m['white'], verts=14, parent=root)
    box((1.55, 0.3, 0.08), (-0.1, -0.27, h), m['concrete'], parent=root)
    extrude('pediment', [(-0.9, h + 0.04), (0.7, h + 0.04), (-0.1, h + 0.3)], 'y', -0.42, -0.12, marble, root)
    for k in range(3):
        box((1.6 - k * 0.1, 0.12, 0.03 + k * 0.03), (-0.1, -0.56 + k * 0.1, 0.05 + (0.03 + k * 0.03) / 2), m['concrete'], parent=root)
    # 行情显示屏：柱廊上沿正面一条红绿交错的发光条
    for k in range(8):
        box((0.17, 0.02, 0.06), (-0.77 + k * 0.19, -0.43, h - 0.02), green if k % 3 else redl, parent=root)
    if L >= 2:  # 两翼
        for sx in (-1, 1):
            box((0.4, 0.9, h - 0.2), (-0.1 + sx * 1.0, 0.4, (h - 0.2) / 2 + 0.05), marble, bevel=0.02, parent=root)
    if L >= 3:  # 屋顶玻璃穹顶
        sphere(0.38, (-0.1, 0.4, h + 0.1), flat('atrium', (0.5, 0.7, 0.8), rough=0.05, metal=0.3), scale=(1.5, 1, 0.55), parent=root)
    if L >= 4:  # 右后角的塔楼（避开大厅，整栋看得见）
        th = 1.8 if L == 4 else 2.9
        top = _office(root, 0.95, 0.95, 0.7, 0.7, int(th / 0.28), flat('extower', (0.1, 0.15, 0.22), rough=0.1, metal=0.6),
                      flat('extglass', (0.2, 0.4, 0.55), rough=0.05, metal=0.5), m)
        if L >= 5:  # LED 行情带绕楼一圈
            for z in (0.9, 1.6, 2.3):
                box((0.72, 0.72, 0.05), (0.95, 0.95, z), green if z != 1.6 else redl, parent=root)
            cyl(0.012, 0.5, (0.95, 0.95, top + 0.25), m['pipe'], verts=6, parent=root)
    # 铜牛
    bronze = flat('bronze', (0.45, 0.28, 0.12), rough=0.35, metal=0.9)
    box((0.3, 0.14, 0.14), (0.9, -0.9, 0.22), bronze, bevel=0.04, parent=root)
    box((0.1, 0.11, 0.1), (1.07, -0.9, 0.27), bronze, bevel=0.03, parent=root)
    for dy in (-0.05, 0.05):
        cone(0.02, 0.0, 0.1, (1.11, -0.9 + dy * 1.6, 0.34), bronze, verts=8, rot=(dy * 12, 0, 0), parent=root)
        for dx in (-0.1, 0.1):
            cyl(0.022, 0.13, (0.9 + dx, -0.9 + dy, 0.1), bronze, verts=8, parent=root)
    box((0.42, 0.24, 0.05), (0.9, -0.9, 0.05), marble, parent=root)
    return root


# 能升级的建筑：名字 → (函数, 占地边长)
LEVELED = {
    'hall': (hall, 3), 'house': (house, 2), 'market': (market, 2), 'farm': (farm, 3), 'powerPlant': (power_plant, 2),
    'granary': (granary, 2), 'vault': (vault, 2), 'lab': (lab, 2),
    'lumberMill': (lumber_mill, 2), 'quarry': (quarry, 2), 'mine': (mine, 2), 'oilWell': (oil_well, 2),
    'arsenal': (arsenal, 3), 'electronicsPlant': (electronics_plant, 3),
    'warehouse': (warehouse, 2), 'oilDepot': (oil_depot, 2), 'ammoDepot': (ammo_depot, 2),
    'bank': (bank, 2), 'privateEnterprise': (private_enterprise, 2), 'stateEnterprise': (state_enterprise, 3),
    'stockExchange': (stock_exchange, 3),
}
