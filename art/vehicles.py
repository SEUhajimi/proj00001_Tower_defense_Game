"""坦克和飞机的建模：每个型号一个函数，用代码按真实型号的外形比例搭出来。

所有模型车头/机头朝 +x，地面在 z = 0（飞机的机身中线在 z = 0，渲染时悬空）。
team 决定阵营标识的颜色（炮塔色带、机翼圆标）。
"""
import math

import bmesh
import bpy

from kit import TEAM, camo, cyl, empty, flat, pbr, sphere


# ---------- 几何体 ----------

def _obj(name, bm, mat, parent, smooth=False, bevel=0.0):
    me = bpy.data.meshes.new(name)
    bm.normal_update()
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    o.data.materials.append(mat)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    if bevel:
        m = o.modifiers.new('bevel', 'BEVEL')
        m.width = bevel
        m.segments = 2
        m.limit_method = 'ANGLE'
    o.parent = parent
    return o


def extrude(name, pts, axis, a0, a1, mat, parent, bevel=0.0, smooth=False):
    """把多边形沿一个轴拉伸成柱体。axis='z'：pts 是 (x, y)；'y'：pts 是 (x, z)（侧面轮廓）；'x'：pts 是 (y, z)。"""
    bm = bmesh.new()

    def v3(p, t):
        return (p[0], p[1], t) if axis == 'z' else (p[0], t, p[1]) if axis == 'y' else (t, p[0], p[1])

    bot = [bm.verts.new(v3(p, a0)) for p in pts]
    top = [bm.verts.new(v3(p, a1)) for p in pts]
    bm.faces.new(bot)
    bm.faces.new(list(reversed(top)))
    for i in range(len(pts)):
        j = (i + 1) % len(pts)
        bm.faces.new([bot[i], bot[j], top[j], top[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(name, bm, mat, parent, smooth, bevel)


def loft(name, sections, mat, parent, n=16):
    """机身：沿 x 轴的一串椭圆截面 (x, 半宽, 半高, 中心高度)，半宽为 0 的截面收成一个尖。"""
    bm = bmesh.new()
    rings = []
    for x, w, h, zc in sections:
        if w <= 0:
            rings.append([bm.verts.new((x, 0, zc))])
        else:
            rings.append([bm.verts.new((x, w * math.cos(2 * math.pi * k / n), zc + h * math.sin(2 * math.pi * k / n))) for k in range(n)])
    for a, b in zip(rings, rings[1:]):
        if len(a) == 1 and len(b) == 1:
            continue
        if len(a) == 1 or len(b) == 1:
            tip, ring = (a[0], b) if len(a) == 1 else (b[0], a)
            for k in range(n):
                bm.faces.new([tip, ring[k], ring[(k + 1) % n]])
        else:
            for k in range(n):
                bm.faces.new([a[k], a[(k + 1) % n], b[(k + 1) % n], b[k]])
    for ring in (rings[0], rings[-1]):
        if len(ring) > 1:
            bm.faces.new(ring)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(name, bm, mat, parent, smooth=True)


def wing(name, planform, thick, z, mat, parent, dihedral=0.0):
    """机翼、平尾：planform 是右半边的平面形状 (x, y)，y 从翼根往外；左右镜像。dihedral 是上反角（弧度）。"""
    for sgn in (1, -1):
        pts = [(x, sgn * y) for x, y in planform]
        if sgn < 0:
            pts.reverse()
        o = extrude(name, pts, 'z', z - thick / 2, z + thick / 2, mat, parent, bevel=thick * 0.3)
        o.rotation_euler = (sgn * dihedral, 0, 0)


def fin(name, profile, thick, mat, parent, y=0.0, cant=0.0):
    """垂尾：profile 是侧面轮廓 (x, z)。cant 是外倾角（弧度）。"""
    o = extrude(name, profile, 'y', y - thick / 2, y + thick / 2, mat, parent, bevel=thick * 0.3)
    o.rotation_euler = (cant, 0, 0)
    return o


def roundels(parent, team, spots, r=0.05):
    """机翼上的阵营圆标。"""
    for x, y, z in spots:
        cyl(r, 0.006, (x, y, z), flat('roundel', TEAM[team], rough=0.6), verts=20, parent=parent)
        cyl(r * 0.45, 0.008, (x, y, z), flat('roundel_c', (0.9, 0.9, 0.88), rough=0.6), verts=16, parent=parent)


def canopy(parent, x, z, length, w=0.055, h=0.05):
    sphere(1, (x, 0, z), flat('glass', (0.04, 0.06, 0.08), rough=0.08, metal=0.4), scale=(length, w, h), parent=parent)


def nacelle(parent, x, y, z, length, r, mat):
    cyl(r, length, (x, y, z), mat, rot=(0, math.radians(90), 0), verts=16, parent=parent)
    cyl(r * 0.7, 0.01, (x - length / 2 - 0.004, y, z), flat('exhaust', (0.03, 0.03, 0.03), rough=0.8), rot=(0, math.radians(90), 0), verts=16, parent=parent)


# ---------- 坦克的共用部件 ----------

def running_gear(root, L, W, track_h, wheels, r, skirt=None):
    track = flat('track', (0.04, 0.04, 0.035), rough=0.9)
    wheel = flat('wheel', (0.1, 0.1, 0.09), rough=0.7, metal=0.2)
    tw = 0.15 * W / 0.62
    for s in (-1, 1):
        y = s * (W / 2 - tw / 2)
        # 履带：两头收窄的侧面轮廓
        extrude('track', [(-L / 2, 0.06), (-L / 2 + 0.06, 0.0), (L / 2 - 0.06, 0.0), (L / 2, 0.06), (L / 2 - 0.02, track_h), (-L / 2 + 0.02, track_h)],
                'y', y - tw / 2, y + tw / 2, track, root, bevel=0.01)
        span = L - 2 * r - 0.08
        for k in range(wheels):
            x = -span / 2 + span * k / max(1, wheels - 1)
            cyl(r, 0.025, (x, s * (W / 2 + 0.004), r + 0.005), wheel, rot=(math.radians(90), 0, 0), verts=16, parent=root)
        if skirt:
            extrude('skirt', [(-L / 2 + 0.03, track_h * 0.45), (L / 2 - 0.02, track_h * 0.45), (L / 2 - 0.05, track_h + 0.02), (-L / 2 + 0.03, track_h + 0.02)],
                    'y', s * (W / 2 + 0.008) - 0.012, s * (W / 2 + 0.008) + 0.012, skirt, root, bevel=0.005)


def gun(root, x0, z, length, r, mat, sleeve=None):
    cyl(r, length, (x0 + length / 2, 0, z), mat, rot=(0, math.radians(90), 0), verts=14, parent=root)
    cyl(r * 1.25, 0.04, (x0 + length + 0.01, 0, z), mat, rot=(0, math.radians(90), 0), verts=14, parent=root)  # 炮口
    if sleeve:  # 抽烟器
        cyl(r * 1.55, 0.07, (x0 + length * sleeve, 0, z), mat, rot=(0, math.radians(90), 0), verts=14, parent=root)


def team_band(root, x, z, length, width, team):
    extrude('band', [(x - length / 2, -width / 2), (x + length / 2, -width / 2), (x + length / 2, width / 2), (x - length / 2, width / 2)],
            'z', z, z + 0.006, flat('band', TEAM[team], rough=0.6), root)


# ---------- 坦克 ----------

def t55(team):
    """一代：T-55。圆顶炮塔靠前，5 对大负重轮，炮管中段有抽烟器，车尾挂油桶。"""
    root = empty('t55')
    paint = pbr('soviet_green', 'green_metal', 2.5, tint=(0.42, 0.5, 0.28))
    metal = flat('gun', (0.16, 0.19, 0.12), rough=0.5, metal=0.4)
    L, W = 0.95, 0.6
    running_gear(root, L, W, 0.16, 5, 0.075)
    extrude('hull', [(-0.47, 0.1), (0.36, 0.1), (0.48, 0.2), (0.38, 0.27), (-0.47, 0.27)], 'y', -W / 2 + 0.02, W / 2 - 0.02, paint, root, bevel=0.015)
    sphere(1, (0.07, 0, 0.27), paint, scale=(0.24, 0.22, 0.13), parent=root)
    team_band(root, 0.07, 0.38, 0.06, 0.2, team)
    cyl(0.04, 0.05, (-0.03, 0.09, 0.38), metal, verts=12, parent=root)  # 车长指挥塔
    gun(root, 0.28, 0.31, 0.56, 0.02, metal, sleeve=0.7)
    for k in (-1, 1):
        cyl(0.045, 0.16, (-0.5, k * 0.12, 0.25), pbr('drum', 'rust', 3, tint=(0.5, 0.55, 0.35)), rot=(math.radians(90), 0, 0), verts=12, parent=root)
    return root


def t72(team):
    """二代：T-72。车身低矮，扁圆炮塔，6 对负重轮，车尾两个油桶，侧面有小块挡泥板。"""
    root = empty('t72')
    paint = pbr('soviet_green2', 'green_metal', 2.5, tint=(0.5, 0.5, 0.3))
    metal = flat('gun', (0.14, 0.17, 0.1), rough=0.5, metal=0.4)
    L, W = 1.0, 0.64
    running_gear(root, L, W, 0.14, 6, 0.062)
    extrude('hull', [(-0.5, 0.09), (0.4, 0.09), (0.5, 0.17), (0.42, 0.24), (-0.5, 0.24)], 'y', -W / 2 + 0.02, W / 2 - 0.02, paint, root, bevel=0.015)
    sphere(1, (-0.06, 0, 0.24), paint, scale=(0.27, 0.24, 0.085), parent=root)
    team_band(root, -0.06, 0.31, 0.06, 0.22, team)
    cyl(0.04, 0.04, (-0.08, 0.1, 0.33), metal, verts=12, parent=root)
    gun(root, 0.22, 0.28, 0.66, 0.022, metal, sleeve=0.55)
    for k in (-1, 1):
        cyl(0.05, 0.18, (-0.54, k * 0.14, 0.2), pbr('drum2', 'rust', 3, tint=(0.45, 0.5, 0.32)), rot=(math.radians(90), 0, 0), verts=12, parent=root)
    return root


def m1a2(team):
    """三代：M1A2 艾布拉姆斯。棱角分明的扁平炮塔，大尾舱，侧裙板，沙漠黄涂装。"""
    root = empty('m1a2')
    paint = flat('desert', (0.46, 0.36, 0.22), rough=0.75, metal=0.1)
    metal = flat('gun', (0.3, 0.25, 0.17), rough=0.6, metal=0.2)
    L, W = 1.1, 0.7
    running_gear(root, L, W, 0.15, 7, 0.055, skirt=paint)
    extrude('hull', [(-0.55, 0.09), (0.44, 0.09), (0.55, 0.2), (0.5, 0.26), (-0.55, 0.27)], 'y', -W / 2 + 0.03, W / 2 - 0.03, paint, root, bevel=0.012)
    turret = [(-0.36, -0.24), (0.1, -0.26), (0.3, -0.13), (0.3, 0.13), (0.1, 0.26), (-0.36, 0.24)]
    extrude('turret', turret, 'z', 0.27, 0.39, paint, root, bevel=0.015)
    team_band(root, -0.05, 0.39, 0.06, 0.4, team)
    extrude('citv', [(-0.12, 0.06), (-0.04, 0.06), (-0.04, 0.14), (-0.12, 0.14)], 'z', 0.39, 0.45, metal, root, bevel=0.008)
    gun(root, 0.28, 0.33, 0.66, 0.022, metal)
    return root


def t14(team):
    """四代：T-14 阿玛塔。车身高大，侧裙板盖住大半个负重轮，无人炮塔棱角锐利，三色迷彩。"""
    root = empty('t14')
    paint = camo('armata', [(0.2, 0.24, 0.14), (0.42, 0.38, 0.24), (0.08, 0.09, 0.07)])
    metal = flat('gun', (0.12, 0.13, 0.1), rough=0.5, metal=0.4)
    L, W = 1.15, 0.7
    running_gear(root, L, W, 0.16, 7, 0.058, skirt=paint)
    extrude('hull', [(-0.57, 0.1), (0.42, 0.1), (0.57, 0.22), (0.5, 0.32), (-0.57, 0.32)], 'y', -W / 2 + 0.03, W / 2 - 0.03, paint, root, bevel=0.012)
    turret = [(-0.24, -0.2), (0.12, -0.2), (0.27, -0.07), (0.27, 0.07), (0.12, 0.2), (-0.24, 0.2)]
    extrude('turret', turret, 'z', 0.32, 0.43, paint, root, bevel=0.02)
    team_band(root, -0.08, 0.43, 0.05, 0.3, team)
    extrude('sight', [(0.0, -0.14), (0.08, -0.14), (0.08, -0.08), (0.0, -0.08)], 'z', 0.43, 0.49, metal, root, bevel=0.008)
    gun(root, 0.25, 0.37, 0.72, 0.026, metal)
    return root


# ---------- 战斗机 ----------

def mig15(team):
    """一代：米格-15。机头圆口进气，35° 后掠翼，T 形尾翼，金属本色。"""
    root = empty('mig15')
    skin = flat('alu', (0.42, 0.44, 0.46), rough=0.4, metal=0.75)
    loft('fuselage', [(0.6, 0.065, 0.065, 0), (0.5, 0.09, 0.09, 0), (0.1, 0.11, 0.11, 0), (-0.35, 0.08, 0.08, 0.01), (-0.6, 0.05, 0.05, 0.02)], skin, root)
    cyl(0.05, 0.01, (0.605, 0, 0), flat('intake', (0.02, 0.02, 0.02)), rot=(0, math.radians(90), 0), verts=16, parent=root)
    wing('wing', [(0.15, 0.06), (-0.18, 0.62), (-0.32, 0.62), (-0.13, 0.06)], 0.03, 0.0, skin, root, dihedral=math.radians(-2))
    fin('fin', [(-0.32, 0.06), (-0.58, 0.06), (-0.68, 0.36), (-0.55, 0.36)], 0.025, skin, root)
    wing('stab', [(-0.54, 0.0), (-0.62, 0.22), (-0.7, 0.22), (-0.67, 0.0)], 0.02, 0.35, skin, root)
    canopy(root, 0.27, 0.085, 0.11)
    roundels(root, team, [(-0.12, 0.42, 0.02), (-0.12, -0.42, 0.02)])
    return root


def mig21(team):
    """二代：米格-21。细长机身，机头锥形进气，三角翼，小平尾。"""
    root = empty('mig21')
    skin = flat('grey', (0.24, 0.27, 0.24), rough=0.55, metal=0.3)
    loft('fuselage', [(0.72, 0, 0, 0), (0.62, 0.05, 0.05, 0), (0.4, 0.075, 0.08, 0), (0.0, 0.085, 0.09, 0), (-0.5, 0.07, 0.07, 0), (-0.66, 0.06, 0.06, 0)], skin, root)
    wing('wing', [(0.15, 0.06), (-0.42, 0.5), (-0.5, 0.5), (-0.46, 0.06)], 0.028, 0.0, skin, root)
    wing('stab', [(-0.46, 0.05), (-0.58, 0.22), (-0.65, 0.22), (-0.63, 0.05)], 0.018, 0.0, skin, root)
    fin('fin', [(-0.3, 0.07), (-0.56, 0.07), (-0.67, 0.36), (-0.53, 0.36)], 0.022, skin, root)
    canopy(root, 0.33, 0.08, 0.12, w=0.05)
    roundels(root, team, [(-0.3, 0.32, 0.02), (-0.3, -0.32, 0.02)])
    return root


def f4(team):
    """三代：F-4 鬼怪。粗壮机身两侧进气，双发尾喷口，下反的平尾，东南亚迷彩。"""
    root = empty('f4')
    skin = camo('sea', [(0.22, 0.19, 0.12), (0.11, 0.15, 0.07), (0.3, 0.26, 0.16)])
    loft('fuselage', [(0.75, 0, 0, 0), (0.62, 0.05, 0.05, 0), (0.4, 0.09, 0.08, 0.01), (0.1, 0.13, 0.09, 0), (-0.42, 0.12, 0.08, 0), (-0.6, 0.09, 0.07, 0.02)], skin, root)
    for s in (-1, 1):
        extrude('intake', [(0.32, s * 0.08), (0.32, s * 0.17), (-0.15, s * 0.17), (-0.15, s * 0.08)], 'z', -0.07, 0.05, skin, root, bevel=0.015)
        nacelle(root, -0.57, s * 0.05, -0.01, 0.12, 0.05, flat('nozzle', (0.2, 0.2, 0.2), metal=0.7, rough=0.4))
    wing('wing', [(0.15, 0.12), (-0.2, 0.62), (-0.33, 0.62), (-0.3, 0.12)], 0.03, -0.02, skin, root)
    wing('stab', [(-0.5, 0.06), (-0.6, 0.3), (-0.68, 0.3), (-0.66, 0.06)], 0.02, 0.0, skin, root, dihedral=math.radians(-23))
    fin('fin', [(-0.3, 0.06), (-0.6, 0.06), (-0.7, 0.38), (-0.58, 0.38)], 0.025, skin, root)
    canopy(root, 0.32, 0.08, 0.17)
    roundels(root, team, [(-0.15, 0.45, 0.01), (-0.15, -0.45, 0.01)])
    return root


def f16(team):
    """四代：F-16。单发，机腹进气，气泡座舱，切尖三角翼加边条，浅灰涂装。"""
    root = empty('f16')
    skin = flat('lightgrey', (0.3, 0.32, 0.34), rough=0.55, metal=0.25)
    loft('fuselage', [(0.72, 0, 0, 0.02), (0.6, 0.05, 0.06, 0.02), (0.3, 0.08, 0.08, 0.02), (0.0, 0.1, 0.08, 0), (-0.5, 0.09, 0.08, 0), (-0.7, 0.06, 0.06, 0)], skin, root)
    extrude('intake', [(0.3, -0.07), (0.3, 0.07), (-0.05, 0.07), (-0.05, -0.07)], 'z', -0.11, -0.03, skin, root, bevel=0.02)
    wing('lex', [(0.36, 0.04), (0.08, 0.11), (-0.02, 0.11), (-0.02, 0.04)], 0.015, 0.0, skin, root)
    wing('wing', [(0.1, 0.08), (-0.28, 0.48), (-0.36, 0.48), (-0.36, 0.08)], 0.025, 0.0, skin, root)
    wing('stab', [(-0.5, 0.07), (-0.62, 0.28), (-0.7, 0.28), (-0.7, 0.07)], 0.018, 0.0, skin, root)
    fin('fin', [(-0.35, 0.07), (-0.6, 0.07), (-0.7, 0.38), (-0.58, 0.38)], 0.022, skin, root)
    nacelle(root, -0.72, 0, 0, 0.08, 0.055, flat('nozzle', (0.25, 0.25, 0.25), metal=0.7, rough=0.4))
    canopy(root, 0.4, 0.1, 0.16, w=0.05, h=0.06)
    roundels(root, team, [(-0.2, 0.32, 0.015), (-0.2, -0.32, 0.015)])
    return root


def f22(team):
    """五代：F-22。宽扁机身，梯形翼，菱形平尾，双外倾垂尾，深灰隐身涂装。"""
    root = empty('f22')
    skin = flat('stealth', (0.1, 0.11, 0.12), rough=0.65, metal=0.15)
    loft('fuselage', [(0.75, 0, 0, 0), (0.6, 0.07, 0.05, 0), (0.3, 0.14, 0.07, 0), (0.0, 0.2, 0.07, 0), (-0.4, 0.18, 0.06, 0), (-0.65, 0.1, 0.05, 0)], skin, root)
    wing('wing', [(0.05, 0.15), (-0.28, 0.6), (-0.42, 0.6), (-0.42, 0.15)], 0.025, 0.0, skin, root)
    wing('stab', [(-0.42, 0.12), (-0.58, 0.38), (-0.72, 0.34), (-0.7, 0.12)], 0.018, 0.0, skin, root)
    for s in (-1, 1):
        fin('fin', [(-0.28, 0.05), (-0.55, 0.05), (-0.62, 0.3), (-0.48, 0.3)], 0.02, skin, root, y=s * 0.13, cant=s * math.radians(-26))
    canopy(root, 0.38, 0.08, 0.15, w=0.05, h=0.05)
    roundels(root, team, [(-0.25, 0.42, 0.015), (-0.25, -0.42, 0.015)], r=0.04)
    return root


# ---------- 轰炸机 ----------

def h6(team):
    """一级：轰-6（图-16）。长机身，35° 后掠翼，两台发动机贴在翼根，尾部炮塔。"""
    root = empty('h6')
    skin = flat('silver', (0.38, 0.4, 0.42), rough=0.45, metal=0.6)
    loft('fuselage', [(1.2, 0, 0, 0), (1.05, 0.09, 0.09, 0), (0.8, 0.14, 0.14, 0), (-0.6, 0.14, 0.14, 0), (-1.0, 0.1, 0.1, 0.03), (-1.2, 0.06, 0.06, 0.05)], skin, root)
    wing('wing', [(0.25, 0.12), (-0.45, 1.0), (-0.6, 1.0), (-0.35, 0.12)], 0.05, -0.02, skin, root, dihedral=math.radians(-3))
    for s in (-1, 1):
        nacelle(root, -0.02, s * 0.22, -0.02, 0.6, 0.09, skin)
    wing('stab', [(-0.85, 0.08), (-1.05, 0.45), (-1.15, 0.45), (-1.08, 0.08)], 0.03, 0.04, skin, root)
    fin('fin', [(-0.72, 0.12), (-1.08, 0.12), (-1.22, 0.55), (-1.05, 0.55)], 0.035, skin, root)
    canopy(root, 0.95, 0.1, 0.16, w=0.07, h=0.06)
    roundels(root, team, [(-0.2, 0.65, 0.01), (-0.2, -0.65, 0.01)], r=0.08)
    return root


def b52(team):
    """二级：B-52。细长机身，大展弦比后掠上单翼，翼下 4 组双发吊舱，高大垂尾。"""
    root = empty('b52')
    skin = camo('b52', [(0.18, 0.2, 0.16), (0.12, 0.15, 0.1), (0.24, 0.24, 0.2)])
    pod = flat('pod', (0.3, 0.32, 0.28), rough=0.5, metal=0.3)
    loft('fuselage', [(1.3, 0, 0, 0), (1.15, 0.1, 0.1, 0), (0.9, 0.13, 0.14, 0), (-0.8, 0.12, 0.13, 0), (-1.3, 0.07, 0.08, 0.04)], skin, root)
    wing('wing', [(0.35, 0.1), (-0.4, 1.4), (-0.55, 1.4), (-0.25, 0.1)], 0.05, 0.1, skin, root, dihedral=math.radians(-4))
    for s in (-1, 1):
        for y, x in ((0.55, 0.12), (0.95, -0.12)):
            for dy in (-0.045, 0.045):
                nacelle(root, x, s * (y + dy), -0.02, 0.3, 0.04, pod)
    wing('stab', [(-0.95, 0.08), (-1.15, 0.5), (-1.27, 0.5), (-1.22, 0.08)], 0.03, 0.05, skin, root)
    fin('fin', [(-0.75, 0.12), (-1.15, 0.12), (-1.3, 0.65), (-1.1, 0.65)], 0.035, skin, root)
    canopy(root, 1.12, 0.09, 0.14, w=0.08, h=0.05)
    roundels(root, team, [(-0.3, 0.9, 0.12), (-0.3, -0.9, 0.12)], r=0.08)
    return root


def tu160(team):
    """三级：图-160。白色修长机身与翼套融合，大后掠可变翼，机身下两组双发短舱，十字尾翼。"""
    root = empty('tu160')
    skin = flat('white', (0.55, 0.56, 0.57), rough=0.45, metal=0.15)
    loft('fuselage', [(1.3, 0, 0, 0), (1.1, 0.09, 0.09, 0), (0.7, 0.15, 0.12, 0), (0.2, 0.22, 0.11, 0), (-0.6, 0.2, 0.1, 0), (-1.2, 0.1, 0.08, 0.03)], skin, root)
    wing('glove', [(0.7, 0.12), (0.1, 0.32), (-0.3, 0.32), (-0.3, 0.12)], 0.04, 0.0, skin, root)
    wing('wing', [(0.1, 0.3), (-0.62, 1.05), (-0.74, 1.05), (-0.3, 0.32)], 0.035, 0.0, skin, root)
    for s in (-1, 1):
        extrude('nacelle', [(-0.25, s * 0.18), (-0.25, s * 0.42), (-0.85, s * 0.42), (-0.85, s * 0.18)], 'z', -0.16, -0.04, skin, root, bevel=0.03)
    fin('fin', [(-0.7, 0.1), (-1.15, 0.1), (-1.3, 0.55), (-1.1, 0.55)], 0.035, skin, root)
    wing('stab', [(-0.95, 0.0), (-1.1, 0.42), (-1.2, 0.42), (-1.2, 0.0)], 0.025, 0.3, skin, root)
    canopy(root, 1.0, 0.09, 0.15, w=0.07, h=0.05)
    roundels(root, team, [(-0.4, 0.75, 0.02), (-0.4, -0.75, 0.02)], r=0.07)
    return root


def b2(team):
    """四级：B-2。飞翼布局，前缘大后掠，后缘锯齿，中间一个隆起的座舱，深灰隐身涂装。"""
    root = empty('b2')
    skin = flat('b2', (0.06, 0.065, 0.075), rough=0.6, metal=0.1)
    half = [(0.65, 0.0), (-0.35, 1.5), (-0.5, 1.45), (-0.25, 1.0), (-0.48, 0.62), (-0.25, 0.28), (-0.4, 0.0)]
    pts = half + [(x, -y) for x, y in reversed(half[1:-1])]
    extrude('wing', pts, 'z', -0.04, 0.04, skin, root, bevel=0.03)
    sphere(1, (0.15, 0, 0.03), skin, scale=(0.5, 0.32, 0.08), parent=root)
    canopy(root, 0.45, 0.07, 0.1, w=0.08, h=0.03)
    roundels(root, team, [(-0.15, 0.85, 0.045), (-0.15, -0.85, 0.045)], r=0.05)
    return root


# 游戏单位 → (建模函数, 渲染图尺寸（2 倍分辨率的像素）, 是否飞机)
MODELS = {
    'tank1': (t55, 176, False), 'tank2': (t72, 176, False), 'tank3': (m1a2, 192, False), 'tank4': (t14, 192, False),
    'fighter1': (mig15, 224, True), 'fighter2': (mig21, 224, True), 'fighter3': (f4, 240, True),
    'fighter4': (f16, 240, True), 'fighter5': (f22, 240, True),
    'bomber1': (h6, 400, True), 'bomber2': (b52, 440, True), 'bomber3': (tu160, 420, True), 'bomber4': (b2, 420, True),
}
