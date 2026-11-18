document.querySelector('#retry').addEventListener('click', () => location.reload());
window.addEventListener('online', () => {
  document.querySelector('#status').textContent = '연결이 복구됐어요. 다시 시도를 눌러 주세요.';
});
