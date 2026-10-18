export interface Point {
  x: number;
  y: number;
}

const SQRT2 = Math.SQRT2;
const DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, SQRT2], [1, -1, SQRT2], [-1, 1, SQRT2], [-1, -1, SQRT2],
];

// 战场网格：记录岩石（挡路）和建筑占地（不挡路，部队可以穿过建筑，但不能在上面再盖建筑）。
export class Grid {
  readonly rock: Uint8Array;
  readonly occupant: Int32Array; // 建筑实体 id，-1 = 空
  readonly tankBlock: Uint8Array; // 拒马：坦克过不去（几座拒马叠着就是几）
  readonly slow: Uint8Array; // 铁丝网：步兵走过减速

  constructor(readonly w: number, readonly h: number) {
    this.rock = new Uint8Array(w * h);
    this.occupant = new Int32Array(w * h).fill(-1);
    this.tankBlock = new Uint8Array(w * h);
    this.slow = new Uint8Array(w * h);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  idx(x: number, y: number): number {
    return y * this.w + x;
  }

  isWalkable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.rock[this.idx(x, y)] === 0;
  }

  // 坦克还要绕开拒马
  passable(x: number, y: number, tank: boolean): boolean {
    return this.isWalkable(x, y) && !(tank && this.tankBlock[this.idx(x, y)] > 0);
  }

  // 不能放东西：岩石或已有建筑
  isBlocked(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return true;
    const i = this.idx(x, y);
    return this.rock[i] === 1 || this.occupant[i] !== -1;
  }

  setRock(x: number, y: number): void {
    if (this.inBounds(x, y)) this.rock[this.idx(x, y)] = 1;
  }

  setOccupant(x: number, y: number, w: number, h: number, id: number): void {
    for (let j = y; j < y + h; j++) {
      for (let i = x; i < x + w; i++) this.occupant[this.idx(i, j)] = id;
    }
  }

  // 8 方向 A*，绕开岩石（坦克还绕开拒马），不允许斜穿障碍的角。返回的路径不含起点，坐标为格子中心。
  findPath(sx: number, sy: number, gx: number, gy: number, tank = false): Point[] | null {
    const ok = (x: number, y: number) => this.passable(x, y, tank);
    if (!ok(gx, gy)) return null;
    const start = this.idx(sx, sy), goal = this.idx(gx, gy);
    if (start === goal) return [];

    const n = this.w * this.h;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const heap = new MinHeap();
    const hx = (x: number, y: number) => {
      const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
      return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
    };

    g[start] = 0;
    heap.push(hx(sx, sy), start);
    while (heap.size > 0) {
      const cur = heap.pop();
      if (cur === goal) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const cx = cur % this.w, cy = (cur - cx) / this.w;
      for (const [dx, dy, cost] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (!ok(nx, ny)) continue;
        if (dx !== 0 && dy !== 0 && (!ok(cx + dx, cy) || !ok(cx, cy + dy))) continue;
        const ni = this.idx(nx, ny);
        const ng = g[cur] + cost;
        if (ng < g[ni]) {
          g[ni] = ng;
          came[ni] = cur;
          heap.push(ng + hx(nx, ny), ni);
        }
      }
    }
    if (came[goal] === -1) return null;

    const path: Point[] = [];
    for (let i = goal; i !== start; i = came[i]) {
      const x = i % this.w;
      path.push({ x: x + 0.5, y: (i - x) / this.w + 0.5 });
    }
    return path.reverse();
  }
}

class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size(): number {
    return this.vals.length;
  }

  push(key: number, val: number): void {
    const k = this.keys, v = this.vals;
    let i = v.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p];
      i = p;
    }
    k[i] = key; v[i] = val;
  }

  pop(): number {
    const k = this.keys, v = this.vals;
    const top = v[0];
    const lastK = k.pop()!, lastV = v.pop()!;
    const n = v.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lastK) break;
        k[i] = k[c]; v[i] = v[c];
        i = c;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return top;
  }
}
