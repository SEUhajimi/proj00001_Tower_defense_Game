"""基地建筑、防御塔、工事的建模：每种建筑一个函数，用代码搭出写实军事风格的外形。

坐标同 kit.py：游戏的格子 (x, y) 对应 Blender 的 (x, -y)，占地中心在原点，地面 z = 0。
相机在 +x、-y 方向的上空，所以门、窗、招牌这些“正面”的东西放在 +x 面和 -y 面，高的东西放到后面（+y、-x）。
每个函数返回根节点；team 决定旗帜、色带这些阵营标识的颜色。
"""
import math

import bpy
from mathutils import Vector

from kit import TEAM, box, cyl, empty, flat, pbr, sphere
from vehicles import extrude
import vehicles


# ---------- 材质 ----------

def mats():
    """常用材质（每次重置场景后重新取）。"""
    return {
        'pad': pbr('pad', 'concrete_floor', 0.6),
        'asphalt': pbr('asphalt', 'asphalt', 0.5, tint=(0.75, 0.75, 0.75)),
        'concrete': pbr('concrete', 'concrete', 1.0, tint=(0.82, 0.8, 0.75)),
        'facade': pbr('facade', 'concrete', 1.2, tint=(1.15, 1.12, 1.05)),
        'brick': pbr('brick', 'brick', 1.5),
        'roof': pbr('roof', 'roof', 2.0, tint=(0.8, 0.55, 0.45)),
        'planks': pbr('planks', 'planks', 1.5),
        'bark': pbr('bark', 'bark', 3.0),
        'corrugated': pbr('corr', 'corrugated', 1.5, tint=(1.5, 1.5, 1.5), rough=0.45, metal=0.15),
        'corr_green': pbr('corr_g', 'corrugated', 1.5, tint=(0.8, 0.95, 0.65), rough=0.55, metal=0.1),
        'rust': pbr('rust', 'rust', 2.0, metal=0.4),
        'steel': flat('steel', (0.5, 0.52, 0.54), rough=0.35, metal=0.3),
        'green': pbr('green', 'green_metal', 2.0, tint=(0.6, 0.68, 0.5)),
        'shutter': pbr('shutter', 'shutter', 1.0, tint=(0.6, 0.62, 0.6)),
        'grass': pbr('grass', 'grass', 1.0),
        'dirt': pbr('dirt', 'dirt', 0.8),
        'rock': pbr('rock', 'concrete', 1.5, tint=(0.78, 0.72, 0.62)),
        'laterite': pbr('laterite', 'laterite', 1.0),
        'mud': pbr('mud', 'mud', 1.0, tint=(0.6, 0.55, 0.5)),
        'glass': flat('glass', (0.05, 0.09, 0.14), rough=0.08, metal=0.5),
        'dark': flat('dark', (0.04, 0.04, 0.04), rough=0.6),
        'white': flat('white', (0.82, 0.82, 0.8), rough=0.5),
        'pipe': flat('pipe', (0.55, 0.56, 0.58), rough=0.35, metal=0.8),
        'yellow': flat('yellow', (0.85, 0.65, 0.08), rough=0.5),
        'red': flat('red', (0.62, 0.1, 0.08), rough=0.5),
        'sand': flat('sand', (0.55, 0.47, 0.33), rough=0.95),
        'olive': flat('olive', (0.2, 0.24, 0.13), rough=0.7, metal=0.2),
        'gun': flat('gunmetal', (0.1, 0.11, 0.1), rough=0.4, metal=0.6),
    }


# ---------- 小部件 ----------

def cone(r1, r2, depth, loc, mat, verts=24, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cone_add(radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot, vertices=verts)
    o = bpy.context.active_object
    o.data.materials.append(mat)
    bpy.ops.object.shade_smooth()
    if parent:
        o.parent = parent
    return o


def prism(r, depth, loc, mat, verts, parent=None):
    """棱柱（八角炮台、六角碉堡）：和圆柱一样，但棱角分明。"""
    o = cyl(r, depth, loc, mat, verts=verts, parent=parent)
    bpy.ops.object.shade_flat()
    return o


def rod(p0, p1, r, mat, parent, verts=10):
    """两点之间的圆杆（钢梁、管道、支腿）。"""
    a, b = Vector(p0), Vector(p1)
    d = b - a
    o = cyl(r, d.length, (a + b) / 2, mat, verts=verts, parent=parent)
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    return o


def pad(root, s, mat, h=0.06):
    """混凝土地坪：比占地略小一圈。"""
    return box((s * 0.95, s * 0.95, h), (0, 0, h / 2), mat, bevel=0.02, parent=root)


def gable(root, cx, cy, L, W, h, z, mat, along='x'):
    """人字形屋顶：沿 along 方向延伸，长 L、宽 W、屋脊高 h，屋檐在 z。"""
    if along == 'x':
        pts = [(cy - W / 2, z), (cy + W / 2, z), (cy, z + h)]
        o = extrude('roof', pts, 'x', cx - L / 2, cx + L / 2, mat, root, bevel=0.01)
    else:
        pts = [(cx - W / 2, z), (cx + W / 2, z), (cx, z + h)]
        o = extrude('roof', pts, 'y', cy - L / 2, cy + L / 2, mat, root, bevel=0.01)
    return o


def arch(root, cx, cy, L, r, mat, along='x', ends=None):
    """拱形顶（半圆柱）：营房、机库。ends 给两头的墙用的材质。"""
    n = 24
    pts = [(r * math.cos(math.pi * k / n), r * math.sin(math.pi * k / n)) for k in range(n + 1)]
    if along == 'x':
        o = extrude('arch', [(cy + p[0], p[1]) for p in pts], 'x', cx - L / 2, cx + L / 2, mat, root, smooth=True)
    else:
        o = extrude('arch', [(cx + p[0], p[1]) for p in pts], 'y', cy - L / 2, cy + L / 2, mat, root, smooth=True)
    if ends:
        for sgn in (-1, 1):
            if along == 'x':
                extrude('end', [(cy + p[0], p[1]) for p in pts], 'x', cx + sgn * L / 2 - 0.02, cx + sgn * L / 2 + 0.02, ends, root)
            else:
                extrude('end', [(cx + p[0], p[1]) for p in pts], 'y', cy + sgn * L / 2 - 0.02, cy + sgn * L / 2 + 0.02, ends, root)
    return o


def windows_y(root, x0, x1, y, zs, mat, n, w=0.14, h=0.18):
    """-y 面（画面左下）上的一排排窗户。"""
    for z in zs:
        for k in range(n):
            x = x0 + (x1 - x0) * (k + 0.5) / n
            box((w, 0.02, h), (x, y, z), mat, parent=root)


def windows_x(root, y0, y1, x, zs, mat, n, w=0.14, h=0.18):
    """+x 面（画面右下）上的窗户。"""
    for z in zs:
        for k in range(n):
            y = y0 + (y1 - y0) * (k + 0.5) / n
            box((0.02, w, h), (x, y, z), mat, parent=root)


def flag(root, x, y, team, h=1.4):
    cyl(0.02, h, (x, y, h / 2), flat('pole', (0.6, 0.6, 0.62), metal=0.8, rough=0.3), verts=10, parent=root)
    box((0.02, 0.36, 0.22), (x, y + 0.19, h - 0.12), flat('flag', TEAM[team], rough=0.8), parent=root)


def crates(root, x, y, n, mat, s=0.22):
    """一堆物资箱。"""
    spots = [(0, 0, 0), (s * 1.1, 0, 0), (0, s * 1.1, 0), (s * 0.55, s * 0.5, 1), (s * 1.1, s * 1.1, 0), (s * 0.55, 0, 1)]
    for dx, dy, lv in spots[:n]:
        box((s, s, s * 0.85), (x + dx, y + dy, 0.06 + s * 0.425 + lv * s * 0.85), mat, bevel=0.015, parent=root)


def tank_storage(root, x, y, r, h, mat, cap=None):
    """立式储罐：圆柱 + 微拱的顶。"""
    cyl(r, h, (x, y, h / 2 + 0.05), mat, verts=32, parent=root)
    sphere(r, (x, y, h + 0.05), cap or mat, scale=(1, 1, 0.18), parent=root)


def tree(root, x, y, s=1.0):
    trunk = flat('trunk', (0.2, 0.13, 0.07), rough=0.9)
    leaf = flat('leaf', (0.1, 0.2, 0.06), rough=0.9)
    cyl(0.04 * s, 0.35 * s, (x, y, 0.17 * s), trunk, verts=8, parent=root)
    sphere(0.22 * s, (x, y, 0.45 * s), leaf, scale=(1, 1, 1.1), parent=root)
    sphere(0.15 * s, (x + 0.08 * s, y - 0.06 * s, 0.6 * s), leaf, parent=root)


def sandbags(root, pts, z0=0.0, layers=2, mat=None):
    """沿一串点摆沙袋墙。"""
    m = mat or flat('sand', (0.55, 0.47, 0.33), rough=0.95)
    for lv in range(layers):
        for i in range(len(pts) - 1):
            a, b = Vector((*pts[i], 0)), Vector((*pts[i + 1], 0))
            d = b - a
            n = max(1, round(d.length / 0.2))
            ang = math.atan2(d.y, d.x)
            for k in range(n):
                p = a + d * ((k + 0.5 + (lv % 2) * 0.5) / n if k < n - 1 or lv % 2 == 0 else (k + 0.5) / n)
                box((0.2, 0.12, 0.09), (p.x, p.y, z0 + 0.05 + lv * 0.085), m, bevel=0.035, rot=(0, 0, ang), parent=root)


# 民生、资源、工业、仓储这些能升级的建筑在 levels.py（每级一个样子）


# ---------- 军工 ----------

def barracks(team):
    """兵营：半圆拱形营房（铁皮）+ 混凝土地坪 + 沙袋 + 旗杆。"""
    root, m = empty('barracks'), mats()
    box((2.8, 2.8, 0.08), (0, 0, 0.04), m['pad'], bevel=0.02, parent=root)
    arch(root, 0.1, 0.25, 2.2, 0.78, m['corr_green'], along='x', ends=pbr('wall', 'concrete', 1.0, tint=(0.8, 0.78, 0.72)))
    box((0.06, 0.42, 0.5), (1.21, 0.25, 0.25), m['shutter'], parent=root)
    for k in (-0.5, 0.1, 0.7):
        box((0.22, 0.04, 0.14), (k, -0.4, 0.42), m['dark'], rot=(math.radians(-25), 0, 0), parent=root)
    sandbags(root, [(-1.15, -1.05), (0.05, -1.05)], 0.08)
    flag(root, 1.15, -1.1, team, 1.6)
    crates(root, -1.15, 0.9, 3, m['green'], 0.28)
    return root


def tank_factory(team):
    """战车工厂：高大的装配车间，正面大卷帘门；门外龙门吊下停着一辆刚下线的坦克。"""
    root, m = empty('tankFactory'), mats()
    pad(root, 3, m['asphalt'])
    box((1.5, 2.0, 0.85), (-0.55, 0.3, 0.48), m['corr_green'], parent=root)
    gable(root, -0.55, 0.3, 2.1, 1.6, 0.3, 0.9, m['corrugated'], along='y')
    box((0.02, 0.8, 0.65), (0.21, -0.1, 0.38), m['shutter'], parent=root)
    windows_y(root, -1.2, 0.1, -0.705, (0.7,), m['glass'], 4, w=0.18, h=0.1)
    yellow = m['yellow']
    for y in (-0.95, 0.45):
        for x in (0.35, 1.25):
            box((0.06, 0.06, 0.95), (x, y, 0.5), yellow, parent=root)
        box((1.0, 0.07, 0.08), (0.8, y, 0.98), yellow, parent=root)
    box((0.08, 1.45, 0.08), (0.8, -0.25, 0.96), yellow, parent=root)
    tank = vehicles.t72(team)
    tank.location = (0.85, -0.3, 0.06)
    tank.rotation_euler = (0, 0, math.radians(-90))
    return root


def airfield(team, level=5, rot=0):
    """机场（8×4）：后排 level 座敞口拱形机库（没建的位置是空地基），库门前停机坪，
    前面滑行道，最前面一条带标线的跑道。尺寸和 shared/sim/base/airfield.ts 一致（那边的 lx、ly）。
    飞机不画在图里，游戏按机位另画。rot = 1 时整体转成长边沿 y（跑道仍在靠镜头的一侧）。"""
    root, m = empty('airfield'), mats()

    def P(lx, ly, z=0.0):
        """机场坐标 → Blender 坐标（占地中心为原点，游戏的 y 是 Blender 的 -y）。"""
        return (lx - 4, 2 - ly, z)

    def strip(lx0, lx1, ly0, ly1, z, h, mat, bevel=0.0):
        return box((lx1 - lx0, ly1 - ly0, h), P((lx0 + lx1) / 2, (ly0 + ly1) / 2, z + h / 2), mat, bevel=bevel, parent=root)

    white, yellow = m['white'], m['yellow']
    strip(0.05, 7.95, 0.05, 3.95, 0, 0.03, m['pad'], bevel=0.02)  # 整块混凝土地坪
    # 跑道：沥青、两边白色边线、中线虚线、两头的斑马线
    strip(0.1, 7.9, 2.85, 3.75, 0.03, 0.02, m['asphalt'])
    for ly in (2.9, 3.7):
        strip(0.15, 7.85, ly - 0.012, ly + 0.012, 0.05, 0.003, white)
    lx = 0.9
    while lx < 7.0:
        strip(lx, lx + 0.32, 3.288, 3.312, 0.05, 0.003, white)
        lx += 0.52
    for end in (0.2, 7.5):
        for k in range(6):
            ly = 2.98 + k * 0.12
            strip(end, end + 0.3, ly, ly + 0.07, 0.05, 0.003, white)
    # 跑道边灯
    lamp = flat('lamp', (1.0, 0.75, 0.3), emission=3)
    for k in range(9):
        for ly in (2.86, 3.74):
            bpy.ops.mesh.primitive_uv_sphere_add(radius=0.025, location=P(0.3 + k * 0.92, ly, 0.06))
            o = bpy.context.active_object
            o.data.materials.append(lamp)
            o.parent = root
    # 滑行道：沥青、黄色中线，左头接上跑道
    strip(0.2, 7.8, 2.4, 2.8, 0.03, 0.015, m['asphalt'])
    strip(0.2, 0.85, 2.75, 2.88, 0.03, 0.012, m['asphalt'])
    strip(0.3, 7.7, 2.588, 2.612, 0.046, 0.003, yellow)
    # 机库：每座宽 1.6 格，拱顶开口朝跑道
    for k in range(5):
        cx = 0.8 + 1.6 * k
        if k < level:
            bx, by, _ = P(cx, 0.55)
            arch(root, bx, by, 0.9, 0.66, m['corrugated'], along='y')
            box((1.32, 0.04, 0.66), P(cx, 0.12, 0.33), m['concrete'], parent=root)  # 后墙
            strip(cx - 0.64, cx + 0.64, 0.12, 1.0, 0.03, 0.01, m['dark'])  # 库里的阴影地面
            box((1.36, 0.06, 0.06), P(cx, 1.0, 0.64), m['steel'], parent=root)  # 库门上沿
            # 阵营色带、机库编号牌
            box((0.5, 0.012, 0.1), P(cx, 1.02, 0.5), flat('team', TEAM[team], rough=0.6), parent=root)
            # 停机坪上的黄色停机线（每个机位一条）
            for col in (-0.38, 0.38):
                for ly in (1.3, 2.0):
                    strip(cx + col - 0.012, cx + col + 0.012, ly - 0.3, ly + 0.3, 0.03, 0.003, yellow)
        else:
            # 还没扩建的机库位：一块地基，四角立着桩子
            strip(cx - 0.62, cx + 0.62, 0.15, 1.0, 0.03, 0.04, m['concrete'])
            for dx in (-0.55, 0.55):
                for ly in (0.2, 0.95):
                    box((0.05, 0.05, 0.22), P(cx + dx, ly, 0.13), m['rust'], parent=root)
            crates(root, *P(cx + 0.25, 0.55)[:2], 2, m['planks'], s=0.16)
    flag(root, *P(0.15, 1.15)[:2], team, h=1.0)
    # 跑道尽头的风向袋
    cyl(0.012, 0.5, P(7.85, 2.32, 0.25), m['pipe'], verts=8, parent=root)
    cone(0.05, 0.025, 0.22, P(7.75, 2.32, 0.47), flat('sock', (0.9, 0.35, 0.05), rough=0.7), rot=(0, math.radians(-80), 0), parent=root)
    if rot:
        # (X, Y) → (-Y, -X)：先沿 x 镜像，再转 90°
        root.scale = (-1, 1, 1)
        root.rotation_euler = (0, 0, math.radians(90))
        bpy.context.view_layer.update()
    return root


# ---------- 防御塔和工事（1 格的塔画得高一些） ----------

def modern_mats():
    """现代防御工事的材质：深灰绿装甲、迷彩网、防爆墙填土、警示黄黑。"""
    return {
        'armor': flat('armor', (0.16, 0.19, 0.15), rough=0.55, metal=0.35),
        'armor2': flat('armor2', (0.24, 0.27, 0.22), rough=0.6, metal=0.3),
        'hesco': flat('hesco', (0.42, 0.38, 0.27), rough=0.95),
        'mesh': flat('mesh', (0.35, 0.36, 0.33), rough=0.4, metal=0.8),
        'lens': flat('lens', (0.05, 0.12, 0.2), rough=0.05, metal=0.6),
        'hazard': flat('hazard', (0.9, 0.7, 0.05), rough=0.5),
        'black': flat('hazardk', (0.04, 0.04, 0.04), rough=0.6),
        'net': flat('camonet', (0.2, 0.24, 0.12), rough=1.0),
        'concrete': pbr('rconc', 'concrete', 1.0, tint=(0.88, 0.87, 0.84)),
    }


def hesco(root, x, y, mm, w=0.24, h=0.26, rot=0.0):
    """防爆墙块（铁丝网装土的大方筐）：土色方块，四角立着细钢网柱。"""
    box((w, w, h), (x, y, h / 2), mm['hesco'], bevel=0.015, rot=(0, 0, rot), parent=root)
    for dx in (-1, 1):
        for dy in (-1, 1):
            c, s = math.cos(rot), math.sin(rot)
            px, py = dx * w / 2, dy * w / 2
            cyl(0.008, h + 0.01, (x + px * c - py * s, y + px * s + py * c, h / 2), mm['mesh'], verts=4, parent=root)


def hazard_edge(root, x0, x1, y, z, mm, along='x', n=8):
    """黄黑相间的警示边。"""
    for k in range(n):
        t = x0 + (x1 - x0) * (k + 0.5) / n
        loc = (t, y, z) if along == 'x' else (y, t, z)
        size = ((x1 - x0) / n, 0.02, 0.04) if along == 'x' else (0.02, (x1 - x0) / n, 0.04)
        box(size, loc, mm['hazard'] if k % 2 == 0 else mm['black'], parent=root)


def plinth(root, s, h, mm):
    """方形钢筋混凝土底座，正面两条边有警示边。"""
    box((s, s, h), (0, 0, h / 2), mm['concrete'], bevel=0.03, parent=root)
    hazard_edge(root, -s / 2 + 0.04, s / 2 - 0.04, -s / 2 - 0.005, h - 0.03, mm)
    hazard_edge(root, -s / 2 + 0.04, s / 2 - 0.04, s / 2 + 0.005, h - 0.03, mm, along='y')


def optics(root, x, y, z, mm, parent=None):
    """光电观瞄：小装甲盒，正面一块镜头。"""
    p = parent or root
    box((0.09, 0.1, 0.08), (x, y, z), mm['armor2'], bevel=0.01, parent=p)
    box((0.01, 0.06, 0.05), (x + 0.05, y, z), mm['lens'], parent=p)


def mg_tower(team):
    """机枪塔：混凝土底座上一根钢塔，顶上装甲观察舱，舱顶遥控武器站（双联机枪 + 光电），旁边鞭状天线和探照灯。"""
    root, m, mm = empty('mgTower'), mats(), modern_mats()
    plinth(root, 0.82, 0.12, mm)
    hesco(root, -0.3, 0.3, mm)
    hesco(root, -0.3, 0.05, mm, h=0.2)
    # 方锥形钢塔
    for dx in (-0.16, 0.16):
        for dy in (-0.16, 0.16):
            rod((dx * 1.4, dy * 1.4, 0.12), (dx, dy, 1.0), 0.03, m['steel'], root)
    for z in (0.4, 0.7):
        k = 1.4 - (z - 0.12) / 0.88 * 0.4
        box((0.32 * k, 0.32 * k, 0.025), (0, 0, z), m['steel'], parent=root)
    # 装甲观察舱：上宽下窄
    extrude('cab', [(-0.24, 0.98), (0.24, 0.98), (0.3, 1.25), (-0.3, 1.25)], 'y', -0.27, 0.27, mm['armor'], root, bevel=0.01)
    box((0.62, 0.62, 0.05), (0, 0, 1.28), mm['armor2'], bevel=0.01, parent=root)
    for y in (-0.28, 0.28):
        box((0.4, 0.01, 0.07), (0, y * 1.01, 1.16), m['glass'], parent=root)
    box((0.01, 0.4, 0.07), (0.285, 0, 1.16), m['glass'], parent=root)
    box((0.64, 0.64, 0.035), (0, 0, 1.06), flat('band', TEAM[team], rough=0.5), parent=root)
    # 遥控武器站
    rws = empty('rws')
    rws.parent = root
    cyl(0.1, 0.06, (0, 0, 1.33), mm['armor2'], verts=16, parent=rws)
    box((0.22, 0.18, 0.12), (0, 0, 1.42), mm['armor'], bevel=0.015, parent=rws)
    for s in (-0.04, 0.04):
        rod((0.1, s, 1.43), (0.42, s, 1.44), 0.012, m['gun'], rws)
    optics(root, 0.0, -0.13, 1.45, mm, parent=rws)
    rws.rotation_euler = (0, 0, math.radians(-15))
    cyl(0.006, 0.55, (-0.25, 0.25, 1.55), m['pipe'], verts=4, parent=root)  # 天线
    cyl(0.04, 0.05, (0.25, -0.25, 1.32), m['white'], rot=(0, math.radians(70), 0), verts=12, parent=root)  # 探照灯
    return root


def cannon_tower(team):
    """火炮塔：六角形钢筋混凝土底座，上面一座棱角分明的装甲炮塔（现代自行火炮那种），长炮管带抽烟装置和炮口制退器。"""
    root, m, mm = empty('cannonTower'), mats(), modern_mats()
    prism(0.46, 0.3, (0, 0, 0.15), mm['concrete'], 6, parent=root)
    for k in range(6):  # 警示边
        a = k * math.pi / 3
        box((0.06, 0.06, 0.04), (0.45 * math.cos(a), 0.45 * math.sin(a), 0.28), mm['hazard'], rot=(0, 0, a), parent=root)
    cyl(0.32, 0.06, (0, 0, 0.33), mm['armor2'], verts=24, parent=root)
    turret = empty('turret')
    turret.parent = root
    # 炮塔：前低后高的楔形
    extrude('turret', [(-0.3, 0.36), (0.28, 0.36), (0.36, 0.48), (0.2, 0.62), (-0.3, 0.64)], 'y', -0.24, 0.24, mm['armor'], turret, bevel=0.012)
    box((0.62, 0.5, 0.035), (-0.02, 0, 0.5), flat('band', TEAM[team], rough=0.5), parent=turret)
    box((0.2, 0.42, 0.08), (-0.35, 0, 0.5), mm['armor2'], bevel=0.01, parent=turret)  # 尾舱
    rod((0.3, 0, 0.5), (1.0, 0, 0.53), 0.035, m['gun'], turret)
    cyl(0.05, 0.14, (0.6, 0, 0.515), m['gun'], rot=(0, math.radians(88), 0), verts=14, parent=turret)  # 抽烟装置
    box((0.1, 0.1, 0.07), (1.0, 0, 0.53), m['gun'], bevel=0.01, parent=turret)  # 制退器
    optics(root, 0.05, 0.18, 0.68, mm, parent=turret)
    cyl(0.005, 0.35, (-0.25, 0.15, 0.82), m['pipe'], verts=4, parent=turret)
    turret.rotation_euler = (0, 0, math.radians(-15))
    return root


def at_tower(team):
    """反坦克塔：防爆墙围着的混凝土炮位，中间一座低矮的装甲转塔，两侧各挂一具反坦克导弹发射筒，上面光电瞄准具。"""
    root, m, mm = empty('atTower'), mats(), modern_mats()
    box((0.86, 0.86, 0.14), (0, 0, 0.07), mm['concrete'], bevel=0.03, parent=root)
    for x, y in [(-0.33, 0.33), (-0.33, 0.08), (-0.08, 0.33), (-0.33, -0.17), (0.17, 0.33)]:
        hesco(root, x, y, mm, w=0.2, h=0.24)
    cyl(0.2, 0.06, (0.05, -0.05, 0.17), mm['armor2'], verts=20, parent=root)
    tur = empty('at')
    tur.parent = root
    box((0.32, 0.26, 0.16), (0.05, -0.05, 0.28), mm['armor'], bevel=0.02, parent=tur)
    box((0.33, 0.27, 0.03), (0.05, -0.05, 0.3), flat('band', TEAM[team], rough=0.5), parent=tur)
    for s in (-1, 1):  # 导弹发射筒
        cyl(0.045, 0.55, (0.15, -0.05 + s * 0.19, 0.36), mm['armor2'], rot=(0, math.radians(84), 0), verts=14, parent=tur)
        cyl(0.035, 0.01, (0.43, -0.05 + s * 0.19, 0.39), m['dark'], rot=(0, math.radians(84), 0), verts=14, parent=tur)
        box((0.06, 0.06, 0.05), (0.05, -0.05 + s * 0.15, 0.36), m['steel'], parent=tur)
    optics(root, 0.08, -0.05, 0.42, mm, parent=tur)
    tur.rotation_euler = (0, 0, math.radians(-15))
    return root


def aa_tower(team):
    """防空塔：圆形混凝土平台上的转台，后面竖着相控阵雷达板、顶上转动的跟踪雷达，两侧各一组 4 联导弹箱，中间双管机关炮。"""
    root, m, mm = empty('aaTower'), mats(), modern_mats()
    cyl(0.44, 0.16, (0, 0, 0.08), mm['concrete'], verts=32, parent=root)
    for k in range(12):
        a = k * math.pi / 6
        box((0.08, 0.04, 0.035), (0.44 * math.cos(a), 0.44 * math.sin(a), 0.15), mm['hazard'] if k % 2 else mm['black'],
            rot=(0, 0, a + math.pi / 2), parent=root)
    cyl(0.24, 0.07, (0, 0, 0.2), mm['armor2'], verts=24, parent=root)
    tur = empty('aa')
    tur.parent = root
    box((0.34, 0.3, 0.22), (0, 0, 0.35), mm['armor'], bevel=0.02, parent=tur)
    box((0.35, 0.31, 0.03), (0, 0, 0.4), flat('band', TEAM[team], rough=0.5), parent=tur)
    # 相控阵雷达板（后面，斜着竖起）
    box((0.04, 0.3, 0.3), (-0.2, 0, 0.62), m['white'], rot=(0, math.radians(-15), 0), parent=tur)
    box((0.01, 0.26, 0.26), (-0.175, 0, 0.62), flat('radar', (0.35, 0.38, 0.42), rough=0.3, metal=0.5), rot=(0, math.radians(-15), 0), parent=tur)
    # 跟踪雷达（顶上的小圆盘）
    cyl(0.02, 0.12, (0.0, 0, 0.52), m['steel'], verts=8, parent=tur)
    d = sphere(0.09, (0.0, 0, 0.6), m['white'], scale=(1, 1, 0.3), parent=tur)
    d.rotation_euler = (0, math.radians(70), 0)
    # 两侧导弹箱，斜向上
    for s in (-1, 1):
        box((0.36, 0.13, 0.13), (0.05, s * 0.23, 0.48), mm['armor2'], bevel=0.01, rot=(0, math.radians(-30), 0), parent=tur)
        for i in (-1, 1):
            for j in (-1, 1):
                cyl(0.022, 0.01, (0.22, s * 0.23 + i * 0.03, 0.58 + j * 0.03), m['dark'], rot=(0, math.radians(60), 0), verts=10, parent=tur)
    # 双管机关炮
    for s in (-0.03, 0.03):
        rod((0.15, s, 0.38), (0.55, s, 0.6), 0.014, m['gun'], tur)
    tur.rotation_euler = (0, 0, math.radians(-15))
    return root


def pillbox(team):
    """碉堡：切角的预制混凝土方堡，四面窄射击孔，顶上一座装甲小炮塔（遥控机枪），旁边几块防爆墙。"""
    root, m, mm = empty('pillbox'), mats(), modern_mats()
    s, h = 0.7, 0.36
    c = 0.12
    pts = [(-s / 2 + c, -s / 2), (s / 2 - c, -s / 2), (s / 2, -s / 2 + c), (s / 2, s / 2 - c),
           (s / 2 - c, s / 2), (-s / 2 + c, s / 2), (-s / 2, s / 2 - c), (-s / 2, -s / 2 + c)]
    extrude('box', pts, 'z', 0.0, h, mm['concrete'], root, bevel=0.02)
    extrude('roof', [(x * 1.05, y * 1.05) for x, y in pts], 'z', h, h + 0.05, mm['concrete'], root, bevel=0.015)
    for x, y, rot in [(0, -s / 2, 0), (s / 2, 0, math.pi / 2), (0, s / 2, 0), (-s / 2, 0, math.pi / 2)]:
        box((0.22, 0.03, 0.05), (x, y, 0.25), m['dark'], rot=(0, 0, rot), parent=root)
    hazard_edge(root, -s / 2 + c, s / 2 - c, -s / 2 - 0.005, h - 0.04, mm, n=6)
    # 装甲小炮塔
    cup = empty('cupola')
    cup.parent = root
    cyl(0.14, 0.12, (0, 0, h + 0.11), mm['armor'], verts=16, parent=cup)
    sphere(0.14, (0, 0, h + 0.17), mm['armor'], scale=(1, 1, 0.45), parent=cup)
    cyl(0.145, 0.03, (0, 0, h + 0.1), flat('band', TEAM[team], rough=0.5), verts=16, parent=cup)
    rod((0.1, 0, h + 0.15), (0.38, 0, h + 0.16), 0.012, m['gun'], cup)
    optics(root, 0.02, -0.11, h + 0.21, mm, parent=cup)
    cup.rotation_euler = (0, 0, math.radians(-15))
    hesco(root, -0.36, 0.36, mm, w=0.18, h=0.22)
    hesco(root, 0.36, 0.36, mm, w=0.18, h=0.22)
    return root


def bunker(team):
    """地堡：斜面墙的加固混凝土指挥所，正面钢制防爆门，射击孔；顶上盖着迷彩网，伸出卫星天线、鞭状天线；四周防爆墙。"""
    root, m, mm = empty('bunker'), mats(), modern_mats()
    box((1.9, 1.9, 0.04), (0, 0, 0.02), m['dirt'], parent=root)
    # 斜面墙：底大顶小
    w0, w1, h = 1.45, 1.15, 0.55
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, h / 2 + 0.04))
    o = bpy.context.active_object
    o.scale = (w0, w0, h)
    bpy.ops.object.transform_apply(scale=True)
    for v in o.data.vertices:
        if v.co.z > 0:
            v.co.x *= w1 / w0
            v.co.y *= w1 / w0
    mod = o.modifiers.new('bevel', 'BEVEL')
    mod.width = 0.04
    mod.segments = 2
    o.data.materials.append(mm['concrete'])
    o.parent = root
    # 迷彩网（顶上，四角垂下来一点）
    box((1.25, 1.25, 0.03), (0, 0, h + 0.06), mm['net'], parent=root)
    for x, y in [(-0.6, -0.6), (0.6, -0.6), (0.6, 0.6), (-0.6, 0.6)]:
        box((0.25, 0.25, 0.02), (x * 1.05, y * 1.05, h - 0.02), mm['net'], rot=(math.radians(20 * (1 if y > 0 else -1)), 0, 0), parent=root)
    # 射击孔、防爆门
    for k in (-0.35, 0.35):
        box((0.25, 0.04, 0.06), (k, -0.66, 0.38), m['dark'], rot=(math.radians(-14), 0, 0), parent=root)
        box((0.04, 0.25, 0.06), (0.66, k, 0.38), m['dark'], rot=(0, math.radians(14), 0), parent=root)
    box((0.03, 0.34, 0.34), (0.7, 0.0, 0.22), mm['armor2'], bevel=0.01, parent=root)
    hazard_edge(root, -0.17, 0.17, 0.725, 0.42, mm, along='y', n=6)
    box((0.08, 0.5, 0.04), (0.69, 0, 0.42), flat('band', TEAM[team], rough=0.5), parent=root)
    # 卫星天线、鞭状天线
    cyl(0.02, 0.18, (-0.35, 0.35, h + 0.15), m['steel'], verts=8, parent=root)
    dish = sphere(0.14, (-0.35, 0.35, h + 0.27), m['white'], scale=(1, 1, 0.3), parent=root)
    dish.rotation_euler = (math.radians(35), math.radians(-35), 0)
    cyl(0.006, 0.8, (0.35, 0.4, h + 0.45), m['pipe'], verts=4, parent=root)
    # 四周防爆墙
    for x, y in [(-0.82, -0.82), (-0.58, -0.82), (0.58, -0.82), (0.82, -0.82), (0.82, -0.58), (0.82, 0.58), (0.82, 0.82)]:
        hesco(root, x, y, mm, w=0.22, h=0.26)
    return root


def mortar(team):
    """迫击炮阵地：后半圈防爆墙围着，中间座钣上一门迫击炮（炮管高高扬起），旁边码着炮弹箱。"""
    root, m, mm = empty('mortar'), mats(), modern_mats()
    box((0.86, 0.86, 0.06), (0, 0, 0.03), mm['concrete'], bevel=0.02, parent=root)
    for x, y in [(-0.33, 0.33), (-0.33, 0.08), (-0.08, 0.33), (-0.33, -0.17), (0.17, 0.33)]:
        hesco(root, x, y, mm, w=0.2, h=0.22)
    cyl(0.13, 0.03, (0.08, -0.08, 0.075), mm['armor2'], verts=16, parent=root)  # 座钣
    # 炮管朝画面右边扬起（朝镜头的话看着是竖的）
    rod((0.0, -0.05, 0.09), (0.3, 0.25, 0.7), 0.05, mm['armor'], root)
    cyl(0.055, 0.02, (0.3, 0.25, 0.7), m['dark'], rot=(math.radians(-35), math.radians(35), 0), verts=14, parent=root)
    for s in (-1, 1):  # 两脚架
        rod((0.25 + s * 0.08, 0.12 - s * 0.08, 0.06), (0.19, 0.14, 0.48), 0.014, m['gun'], root)
    box((0.1, 0.1, 0.06), (0.19, 0.14, 0.48), m['gun'], parent=root)
    crates(root, 0.3, 0.1, 3, mm['armor2'], 0.13)
    box((0.14, 0.13, 0.02), (0.3, 0.1, 0.155), flat('band', TEAM[team], rough=0.5), parent=root)
    return root


def mlrs(team):
    """火箭炮：混凝土台上的转台，上面一个斜着扬起的发射箱，正面 3×4 个发射管。"""
    root, m, mm = empty('mlrs'), mats(), modern_mats()
    plinth(root, 0.84, 0.12, mm)
    cyl(0.26, 0.08, (0, 0, 0.16), mm['armor2'], verts=24, parent=root)
    tur = empty('mlrs')
    tur.parent = root
    box((0.3, 0.3, 0.12), (0, 0, 0.26), mm['armor'], bevel=0.02, parent=tur)
    pod = empty('pod')
    pod.parent = tur
    box((0.62, 0.42, 0.3), (0, 0, 0), mm['armor'], bevel=0.015, parent=pod)
    box((0.63, 0.43, 0.03), (0, 0, 0.08), flat('band', TEAM[team], rough=0.5), parent=pod)
    for i in range(4):
        for j in range(3):
            cyl(0.04, 0.01, (0.31, -0.15 + i * 0.1, -0.09 + j * 0.09), m['dark'], rot=(0, math.radians(90), 0), verts=12, parent=pod)
    pod.location = (0.05, 0, 0.45)
    pod.rotation_euler = (0, math.radians(-28), 0)
    tur.rotation_euler = (0, 0, math.radians(-30))
    optics(root, -0.15, -0.12, 0.35, mm, parent=tur)
    return root


def sam_site(team):
    """远程防空导弹：混凝土台上一副发射架，挂着两枚白色大导弹（红色弹头、尾翼），斜指天空；后面一个制导雷达箱。"""
    root, m, mm = empty('samSite'), mats(), modern_mats()
    plinth(root, 0.84, 0.1, mm)
    cyl(0.22, 0.07, (0, 0, 0.135), mm['armor2'], verts=24, parent=root)
    tur = empty('sam')
    tur.parent = root
    box((0.28, 0.32, 0.1), (0, 0, 0.22), mm['armor'], bevel=0.02, parent=tur)
    box((0.29, 0.33, 0.025), (0, 0, 0.25), flat('band', TEAM[team], rough=0.5), parent=tur)
    rail = empty('rail')
    rail.parent = tur
    white = flat('missile', (0.88, 0.88, 0.86), rough=0.4)
    tip = flat('missiletip', (0.75, 0.12, 0.08), rough=0.4)
    for s in (-0.09, 0.09):
        cyl(0.045, 0.75, (0, s, 0.06), white, rot=(0, math.radians(90), 0), verts=16, parent=rail)
        cone(0.045, 0.0, 0.14, (0.44, s, 0.06), tip, rot=(0, math.radians(90), 0), verts=16, parent=rail)
        for k in range(4):  # 尾翼
            a = k * math.pi / 2
            box((0.12, 0.005, 0.07), (-0.32, s + math.cos(a) * 0.05, 0.06 + math.sin(a) * 0.05), m['steel'], rot=(a, 0, 0), parent=rail)
    box((0.7, 0.3, 0.025), (0, 0, 0.0), mm['armor2'], parent=rail)
    rail.location = (0.02, 0, 0.36)
    rail.rotation_euler = (0, math.radians(-40), 0)
    tur.rotation_euler = (0, 0, math.radians(-25))
    box((0.18, 0.2, 0.22), (-0.28, 0.28, 0.21), mm['armor'], bevel=0.015, parent=root)  # 制导雷达
    box((0.01, 0.16, 0.16), (-0.185, 0.28, 0.24), flat('radar', (0.35, 0.38, 0.42), rough=0.3, metal=0.5), parent=root)
    return root


def landmine(team):
    """地雷区：一块翻松的土，半埋着三颗地雷（压发片露在外面），角上插一块黄色三角警示牌。"""
    root, m, mm = empty('landmine'), mats(), modern_mats()
    sphere(0.42, (0, 0, 0.0), pbr('looseearth', 'dirt', 1.5, tint=(0.75, 0.62, 0.48)), scale=(1, 1, 0.06), parent=root)
    olive = flat('mine', (0.22, 0.25, 0.15), rough=0.6, metal=0.3)
    for x, y in [(-0.12, 0.1), (0.15, 0.05), (0.0, -0.17)]:
        cyl(0.09, 0.04, (x, y, 0.03), olive, verts=20, parent=root)
        cyl(0.035, 0.02, (x, y, 0.055), m['gun'], verts=12, parent=root)
    cyl(0.012, 0.35, (0.3, -0.3, 0.17), m['planks'], verts=6, parent=root)
    extrude('warn', [(-0.08, 0.27), (0.08, 0.27), (0.0, 0.41)], 'y', -0.312, -0.3, mm['hazard'], root)
    box((0.06, 0.02, 0.02), (0.3, -0.25, 0.3), flat('teamtag', TEAM[team], rough=0.5), parent=root)
    return root


def barbed_wire(team):
    """铁丝网：一排钢桩，挂着一卷卷蛇腹形刺铁丝。"""
    root, m, mm = empty('barbedWire'), mats(), modern_mats()
    wire = flat('wire', (0.45, 0.45, 0.43), rough=0.35, metal=0.9)
    for x in (-0.4, 0.0, 0.4):
        cyl(0.015, 0.36, (x, 0, 0.18), m['rust'], verts=6, parent=root)
    for k in range(10):  # 蛇腹形：一圈圈竖着的环
        x = -0.42 + k * 0.094
        bpy.ops.mesh.primitive_torus_add(major_radius=0.13, minor_radius=0.006, location=(x, 0, 0.14),
                                         rotation=(0, math.radians(90 - 14), 0), major_segments=20, minor_segments=4)
        o = bpy.context.active_object
        o.data.materials.append(wire)
        o.parent = root
    box((0.9, 0.006, 0.006), (0, 0, 0.3), wire, parent=root)
    box((0.05, 0.03, 0.03), (0.4, 0, 0.36), flat('teamtag', TEAM[team], rough=0.5), parent=root)
    return root


def tank_trap(team):
    """拒马（捷克刺猬）：三根角钢交叉焊成的钢架，两个一组。"""
    root, m, mm = empty('tankTrap'), mats(), modern_mats()
    steel = flat('hedgehog', (0.22, 0.12, 0.07), rough=0.6, metal=0.6)

    def hedgehog(x, y, s, spin):
        for a, b in [((1, 1, 0), (-1, -1, 0)), ((1, -1, 0.0), (-1, 1, 0.0)), ((0, 0, 1), (0, 0, -1))]:
            v0 = (a[0] * 0.2 * s, a[1] * 0.2 * s, a[2] * 0.2 * s)
            v1 = (b[0] * 0.2 * s, b[1] * 0.2 * s, b[2] * 0.2 * s)
            c, sn = math.cos(spin), math.sin(spin)
            p0 = (x + v0[0] * c - v0[1] * sn, y + v0[0] * sn + v0[1] * c, 0.2 * s + v0[2] * 0.9)
            p1 = (x + v1[0] * c - v1[1] * sn, y + v1[0] * sn + v1[1] * c, 0.2 * s + v1[2] * 0.9)
            rod(p0, p1, 0.028 * s, steel, root, verts=4)
    hedgehog(-0.18, 0.15, 1.0, 0.3)
    hedgehog(0.2, -0.15, 0.9, 1.1)
    box((0.04, 0.04, 0.03), (0.0, 0.0, 0.02), flat('teamtag', TEAM[team], rough=0.5), parent=root)
    return root


def radar(team):
    """雷达站（2×2）：混凝土地坪上一间设备房，后面一座钢架塔顶着转动的雷达天线板，旁边一个白色雷达罩（球）。"""
    root, m, mm = empty('radar'), mats(), modern_mats()
    box((1.9, 1.9, 0.06), (0, 0, 0.03), mm['concrete'], bevel=0.02, parent=root)
    hazard_edge(root, -0.9, 0.9, -0.955, 0.05, mm, n=12)
    box((0.6, 0.45, 0.35), (0.45, -0.45, 0.235), mm['armor2'], bevel=0.02, parent=root)  # 设备房
    box((0.62, 0.47, 0.03), (0.45, -0.45, 0.42), flat('band', TEAM[team], rough=0.5), parent=root)
    box((0.02, 0.2, 0.25), (0.755, -0.45, 0.19), m['shutter'], parent=root)
    # 钢架塔
    top = 1.35
    for dx in (-0.12, 0.12):
        for dy in (-0.12, 0.12):
            rod((-0.35 + dx * 1.6, 0.35 + dy * 1.6, 0.06), (-0.35 + dx, 0.35 + dy, top), 0.02, m['steel'], root)
    for z in (0.45, 0.85):
        box((0.36 - z * 0.1, 0.36 - z * 0.1, 0.02), (-0.35, 0.35, z), m['steel'], parent=root)
    cyl(0.06, 0.12, (-0.35, 0.35, top + 0.06), mm['armor'], verts=12, parent=root)
    ant = empty('antenna')
    ant.parent = root
    box((0.08, 0.75, 0.22), (0, 0, 0), m['white'], bevel=0.01, parent=ant)
    for k in range(6):
        box((0.01, 0.7, 0.012), (-0.045, 0, -0.09 + k * 0.036), m['steel'], parent=ant)
    ant.location = (-0.35, 0.35, top + 0.24)
    ant.rotation_euler = (math.radians(-10), 0, math.radians(30))
    # 雷达罩
    cyl(0.05, 0.4, (0.5, 0.5, 0.26), m['steel'], verts=10, parent=root)
    sphere(0.28, (0.5, 0.5, 0.65), m['white'], parent=root)
    cyl(0.006, 0.6, (0.75, -0.75, 0.36), m['pipe'], verts=4, parent=root)
    return root


# ---------- 战场上的建筑 ----------

def hq(team):
    """指挥部：两层混凝土指挥楼，屋顶大雷达和天线阵，旁边直升机停机坪，门口阵营旗。"""
    root, m = empty('hq'), mats()
    pad(root, 3, m['pad'])
    box((1.7, 1.3, 0.75), (-0.3, 0.35, 0.43), m['concrete'], bevel=0.04, parent=root)
    box((1.0, 0.8, 0.4), (-0.5, 0.5, 1.0), m['concrete'], bevel=0.03, parent=root)
    windows_y(root, -1.1, 0.5, -0.305, (0.35, 0.62), m['glass'], 5, w=0.18, h=0.1)
    windows_x(root, -0.25, 0.95, 0.555, (0.35, 0.62), m['glass'], 3, w=0.18, h=0.1)
    box((1.72, 0.04, 0.05), (-0.3, -0.31, 0.78), flat('band', TEAM[team]), parent=root)
    cyl(0.05, 0.3, (-0.5, 0.5, 1.35), m['pipe'], verts=10, parent=root)
    dish = sphere(0.35, (-0.5, 0.5, 1.6), m['white'], scale=(1, 1, 0.22), parent=root)
    dish.rotation_euler = (math.radians(40), math.radians(-30), 0)
    for k in range(3):
        cyl(0.01, 0.8, (-0.1 + k * 0.12, 0.8, 1.6), m['pipe'], verts=6, parent=root)
    cyl(0.5, 0.03, (0.75, -0.65, 0.075), m['concrete'], verts=32, parent=root)
    for p, s in [((0.62, -0.65), (0.05, 0.4)), ((0.88, -0.65), (0.05, 0.4)), ((0.75, -0.65), (0.26, 0.05))]:
        box((s[0], s[1], 0.01), (p[0], p[1], 0.095), m['white'], parent=root)
    sandbags(root, [(-1.25, -0.8), (-0.4, -0.8)], 0.06)
    flag(root, 0.3, -1.2, team, 1.5)
    return root


def civil2(team):
    """民用建筑（2 格）：两层平顶砖楼，屋顶一个水箱。"""
    root, m = empty('civil2'), mats()
    pad(root, 2, m['pad'])
    box((1.3, 1.1, 0.75), (-0.1, 0.15, 0.43), m['brick'], bevel=0.01, parent=root)
    box((1.36, 1.16, 0.05), (-0.1, 0.15, 0.82), m['concrete'], parent=root)
    windows_y(root, -0.7, 0.5, -0.405, (0.3, 0.6), m['glass'], 4, w=0.14, h=0.16)
    windows_x(root, -0.35, 0.65, 0.555, (0.3, 0.6), m['glass'], 3, w=0.14, h=0.16)
    cyl(0.14, 0.25, (-0.4, 0.4, 0.97), m['rust'], verts=16, parent=root)
    return root


def civil3(team):
    """民用建筑（3 格）：三层公寓楼，正面一排阳台。"""
    root, m = empty('civil3'), mats()
    pad(root, 3, m['pad'])
    box((2.0, 1.2, 1.05), (-0.2, 0.4, 0.58), m['facade'], bevel=0.02, parent=root)
    box((2.06, 1.26, 0.05), (-0.2, 0.4, 1.12), m['concrete'], parent=root)
    windows_y(root, -1.15, 0.75, -0.205, (0.3, 0.62, 0.94), m['glass'], 6, w=0.15, h=0.16)
    for z in (0.45, 0.77):
        for k in range(3):
            box((0.45, 0.16, 0.03), (-0.9 + k * 0.65, -0.28, z), m['concrete'], parent=root)
            box((0.45, 0.02, 0.1), (-0.9 + k * 0.65, -0.36, z + 0.06), m['pipe'], parent=root)
    windows_x(root, -0.1, 0.9, 0.805, (0.3, 0.62, 0.94), m['glass'], 3, w=0.15, h=0.16)
    return root


# 建筑 → (建模函数, 占地边长, 是否渲染两个阵营)
# 基地建筑只渲染我方（敌方据点里的同款建筑游戏里染色）；塔、工事、指挥部、民用建筑在战场上分阵营
BUILDINGS = {
    'barracks': (barracks, 3, True), 'tankFactory': (tank_factory, 3, False),
    'mgTower': (mg_tower, 1, True), 'cannonTower': (cannon_tower, 1, True), 'atTower': (at_tower, 1, True),
    'aaTower': (aa_tower, 1, True), 'pillbox': (pillbox, 1, True), 'bunker': (bunker, 2, True),
    'mortar': (mortar, 1, False), 'mlrs': (mlrs, 1, False), 'samSite': (sam_site, 1, False), 'radar': (radar, 2, False),
    'landmine': (landmine, 1, False), 'barbedWire': (barbed_wire, 1, False), 'tankTrap': (tank_trap, 1, False),
    'hq': (hq, 3, True), 'civil2': (civil2, 2, True), 'civil3': (civil3, 3, True),
}
