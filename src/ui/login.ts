import { api } from '../game/api';

// 登录界面：盖在整个页面上，登录或注册成功后移除，再把用户名交给 onDone。

export function showLogin(onDone: (username: string) => void, notice = ''): void {
  const root = document.createElement('div');
  root.id = 'login';
  root.innerHTML = `
    <form class="card" autocomplete="on">
      <h1>基地守卫</h1>
      <div class="tabs">
        <button type="button" data-mode="login" class="active">登录</button>
        <button type="button" data-mode="register">注册</button>
      </div>
      <label>用户名<input name="username" autocomplete="username" maxlength="16" required></label>
      <label>密码<input name="password" type="password" autocomplete="current-password" maxlength="64" required></label>
      <label class="confirm" hidden>再输一次密码<input name="confirm" type="password" autocomplete="new-password" maxlength="64"></label>
      <p class="error" role="alert"></p>
      <button type="submit" class="go">登录</button>
      <p class="hint">用户名 2–16 个字（中文、字母、数字、下划线），密码 6 位以上。</p>
    </form>`;
  document.body.appendChild(root);

  const form = root.querySelector('form')!;
  const error = root.querySelector<HTMLElement>('.error')!;
  const go = root.querySelector<HTMLButtonElement>('.go')!;
  const confirm = root.querySelector<HTMLElement>('.confirm')!;
  const pw = form.elements.namedItem('password') as HTMLInputElement;
  let mode: 'login' | 'register' = 'login';
  error.textContent = notice;

  root.querySelectorAll<HTMLButtonElement>('.tabs button').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.mode as typeof mode;
    root.querySelectorAll('.tabs button').forEach(o => o.classList.toggle('active', o === b));
    confirm.hidden = mode === 'login';
    pw.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    go.textContent = mode === 'login' ? '登录' : '注册并进入游戏';
    error.textContent = '';
  }));

  form.addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = new FormData(form);
    const username = String(f.get('username') ?? '').trim(), password = String(f.get('password') ?? '');
    if (mode === 'register' && password !== String(f.get('confirm') ?? '')) {
      error.textContent = '两次输入的密码不一样';
      return;
    }
    go.disabled = true;
    error.textContent = '';
    const r = await api<{ username: string }>(mode, { username, password });
    go.disabled = false;
    if (typeof r === 'string') { error.textContent = r; return; }
    root.remove();
    onDone(r.username);
  });
  (form.elements.namedItem('username') as HTMLInputElement).focus();
}
