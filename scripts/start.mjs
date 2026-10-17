// npm start：同时启动后端（改了代码自动重启）和前端开发服务器，Ctrl+C 一起关掉。
import { spawn } from 'node:child_process';

const procs = [
  { name: '后端', color: 36, cmd: 'npx tsx watch server/index.ts' },
  { name: '前端', color: 35, cmd: 'npx vite --port 5173' },
];

const children = procs.map(({ name, color, cmd }) => {
  const child = spawn(cmd, { shell: true, env: { ...process.env, FORCE_COLOR: '1' } });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let rest = '';
    stream.on('data', buf => {
      const lines = (rest + buf.toString()).split(/\r?\n/);
      rest = lines.pop();
      for (const line of lines) {
        // Node 自带的 SQLite 还标着“实验功能”，警告对玩家没用
        if (line.includes('ExperimentalWarning') || line.includes('--trace-warnings')) continue;
        out.write(tag + line + '\n');
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', code => {
    console.log(`${tag}已退出（${code ?? '被关闭'}）`);
    stopAll();
  });
  return child;
});

console.log('\n  基地守卫启动中，稍等几秒后打开 \x1b[1mhttp://localhost:5173\x1b[0m\n  按 Ctrl+C 关闭\n');

let stopping = false;
function stopAll() {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null) continue;
    // Windows 上要连同子进程一起结束
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(c.pid), '/t', '/f']);
    else c.kill('SIGTERM');
  }
  setTimeout(() => process.exit(0), 500);
}

process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
