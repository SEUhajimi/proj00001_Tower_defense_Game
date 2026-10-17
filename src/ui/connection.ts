import { onConnection } from '../game/api';
import { resync } from '../game/session';

// 页面顶部的连接状态条：断线时提示，连回来后从服务器重新同步存档；登录过期时请玩家重新登录。

export function watchConnection(): void {
  const bar = document.createElement('div');
  bar.id = 'conn';
  bar.hidden = true;
  document.body.appendChild(bar);
  let hideTimer = 0;

  onConnection(state => {
    window.clearTimeout(hideTimer);
    bar.hidden = false;
    bar.className = state;
    if (state === 'offline') {
      bar.textContent = '与服务器断开连接，刚才的操作可能没有保存。正在重新连接……';
    } else if (state === 'expired') {
      bar.innerHTML = '登录已过期，请重新登录。<button type="button">重新登录</button>';
      bar.querySelector('button')!.addEventListener('click', () => location.reload());
    } else {
      // 断线期间本地做的操作服务器没收到，以服务器的存档为准
      bar.textContent = '已重新连上服务器，正在同步存档……';
      void resync().then(err => {
        bar.textContent = err ? `同步失败：${err}` : '已重新连上服务器，存档已同步';
        hideTimer = window.setTimeout(() => { bar.hidden = true; }, 3000);
      });
    }
  });
}
