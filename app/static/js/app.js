'use strict';

/* ── State ────────────────────────────────────────────────────────────── */
let games = [];
let currentGame = null;
let iconOption = 'none';

/* ── Init ─────────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  loadGames();
  setupDragDrop();
});

/* ── API helpers ──────────────────────────────────────────────────────── */
async function api(method, path, body) {
  const opts = { method };
  if (body instanceof FormData) {
    opts.body = body;
  } else if (body) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || res.statusText);
  }
  return res.json().catch(() => null);
}

async function apiUpload(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api' + path);
    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total * 100);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        try { reject(new Error(JSON.parse(xhr.responseText).error)); }
        catch { reject(new Error(xhr.statusText)); }
      }
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.send(formData);
  });
}

/* ── Toast ────────────────────────────────────────────────────────────── */
function toast(msg, type = 'info') {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  document.getElementById('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

/* ── Modal helpers ────────────────────────────────────────────────────── */
function openModal(id) { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }

/* ── Progress ─────────────────────────────────────────────────────────── */
function showProgress(msg = '处理中...') {
  document.getElementById('progress-msg').textContent = msg;
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('progress-overlay').style.display = 'flex';
}
function updateProgress(pct) {
  document.getElementById('progress-bar').style.width = pct + '%';
}
function hideProgress() {
  document.getElementById('progress-overlay').style.display = 'none';
}

/* ── Games List ───────────────────────────────────────────────────────── */
async function loadGames() {
  document.getElementById('loading').style.display = 'flex';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('games-grid').style.display = 'none';

  try {
    games = await api('GET', '/games');
    renderGames();
  } catch (e) {
    toast('加载游戏列表失败: ' + e.message, 'error');
  } finally {
    document.getElementById('loading').style.display = 'none';
  }
}

function renderGames() {
  const grid = document.getElementById('games-grid');
  const empty = document.getElementById('empty-state');

  if (games.length === 0) {
    empty.style.display = 'flex';
    grid.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  grid.style.display = 'grid';
  grid.innerHTML = games.map(g => `
    <div class="game-card" onclick="openGameDetail('${g.id}')">
      <div class="game-card-icon">
        ${g.has_icon
          ? `<img src="/api/games/${g.id}/icon?t=${Date.now()}" alt="${escHtml(g.name)}" loading="lazy">`
          : defaultIconSvg('default-icon')}
      </div>
      <div class="game-card-body">
        <div class="game-card-name" title="${escHtml(g.name)}">${escHtml(g.name)}</div>
        <div class="game-card-meta">
          <span class="game-card-badge">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width:11px;height:11px">
              <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/>
              <polyline points="17 21 17 13 7 13 7 21"/>
            </svg>
            ${g.saves_count} 存档
          </span>
          ${g.archives_count > 0 ? `<span style="color:var(--text3);font-size:0.75rem">${g.archives_count} 文件</span>` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

function defaultIconSvg(cls = '') {
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="2" y="6" width="20" height="12" rx="2"/>
    <path d="M12 12h.01M8 12h.01M16 12h.01"/>
    <path d="M6 9v6M18 9v6"/>
  </svg>`;
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Add / Edit Game ──────────────────────────────────────────────────── */
function openAddGame() {
  document.getElementById('modal-game-title').textContent = '添加游戏';
  document.getElementById('game-edit-id').value = '';
  document.getElementById('game-name').value = '';
  document.getElementById('input-exe').value = '';
  document.getElementById('input-img').value = '';
  document.getElementById('exe-label').textContent = '点击选择 .exe 文件';
  document.getElementById('img-preview-wrap').innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="3" y="3" width="18" height="18" rx="2"/>
      <circle cx="8.5" cy="8.5" r="1.5"/>
      <path d="M21 15l-5-5L5 21"/>
    </svg>
    <div>点击选择图片</div>`;
  document.getElementById('upload-exe').classList.remove('has-file');
  document.getElementById('upload-img').classList.remove('has-file');
  selectIconOption('none');
  openModal('modal-game');
  setTimeout(() => document.getElementById('game-name').focus(), 100);
}

function editCurrentGame() {
  if (!currentGame) return;
  document.getElementById('modal-game-title').textContent = '编辑游戏';
  document.getElementById('game-edit-id').value = currentGame.id;
  document.getElementById('game-name').value = currentGame.name;
  document.getElementById('upload-exe').classList.remove('has-file');
  document.getElementById('upload-img').classList.remove('has-file');
  selectIconOption('none');
  openModal('modal-game');
}

function selectIconOption(opt) {
  iconOption = opt;
  ['exe','img','none'].forEach(o => {
    document.getElementById(`icon-opt-${o}`).classList.toggle('selected', o === opt);
  });
  document.getElementById('upload-exe').style.display = opt === 'exe' ? 'flex' : 'none';
  document.getElementById('upload-img').style.display = opt === 'img' ? 'flex' : 'none';

  // Clear the inactive option to avoid stale previews when switching
  if (opt !== 'exe') {
    document.getElementById('input-exe').value = '';
    document.getElementById('exe-label').textContent = '点击选择 .exe 文件';
    document.getElementById('exe-extract-hint').style.display = 'none';
    document.getElementById('upload-exe').classList.remove('has-file');
  }
  if (opt !== 'img') {
    document.getElementById('input-img').value = '';
    document.getElementById('img-preview-wrap').innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="2"/>
        <circle cx="8.5" cy="8.5" r="1.5"/>
        <path d="M21 15l-5-5L5 21"/>
      </svg>
      <div>点击选择图片</div>`;
    document.getElementById('upload-img').classList.remove('has-file');
  }
}

function previewExe(input) {
  if (input.files[0]) {
    document.getElementById('exe-label').textContent = input.files[0].name;
    document.getElementById('upload-exe').classList.add('has-file');
    document.getElementById('exe-extract-hint').style.display = 'block';
  }
}

function previewImg(input) {
  if (input.files[0]) {
    const url = URL.createObjectURL(input.files[0]);
    document.getElementById('img-preview-wrap').innerHTML =
      `<img src="${url}" style="max-width:120px;max-height:120px;width:auto;height:auto;object-fit:contain;border-radius:8px;display:block">
       <div>${escHtml(input.files[0].name)}</div>`;
    document.getElementById('upload-img').classList.add('has-file');
  }
}

async function submitGame(e) {
  e.preventDefault();
  const name = document.getElementById('game-name').value.trim();
  if (!name) { toast('请输入游戏名称', 'error'); return; }

  const editId = document.getElementById('game-edit-id').value;
  const fd = new FormData();
  fd.append('name', name);

  if (iconOption === 'exe') {
    const exeFile = document.getElementById('input-exe').files[0];
    if (exeFile) fd.append('exe_file', exeFile);
  } else if (iconOption === 'img') {
    const imgFile = document.getElementById('input-img').files[0];
    if (imgFile) fd.append('icon_file', imgFile);
  }

  showProgress(editId ? '更新游戏中...' : '添加游戏中...');
  try {
    let result;
    if (editId) {
      const res = await fetch('/api/games/' + editId, { method: 'PUT', body: fd });
      result = await res.json().catch(() => ({}));
    } else {
      const res = await fetch('/api/games', { method: 'POST', body: fd });
      result = await res.json().catch(() => ({}));
    }
    closeModal('modal-game');
    toast(editId ? '游戏已更新' : '游戏已添加', 'success');
    if (iconOption === 'exe' && !result.has_icon) {
      toast('未能从 .exe 提取图标，将使用默认图标', 'info');
    }
    await loadGames();
    if (editId && currentGame && currentGame.id === editId) {
      const updated = games.find(g => g.id === editId);
      if (updated) { currentGame = updated; updateDetailHeader(); }
    }
  } catch (err) {
    toast('操作失败: ' + err.message, 'error');
  } finally {
    hideProgress();
  }
}

/* ── Game Detail ──────────────────────────────────────────────────────── */
async function openGameDetail(id) {
  currentGame = games.find(g => g.id === id);
  if (!currentGame) return;
  updateDetailHeader();
  switchTab('saves');
  openModal('modal-detail');
  loadSaves();
}

function updateDetailHeader() {
  const g = currentGame;
  const icon = document.getElementById('detail-icon');
  icon.src = g.has_icon ? `/api/games/${g.id}/icon?t=${Date.now()}` : '';
  icon.style.display = g.has_icon ? 'block' : 'none';
  document.getElementById('detail-name').textContent = g.name;
}

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    const tabs = ['saves','archives'];
    t.classList.toggle('active', tabs[i] === tab);
  });
  document.getElementById('tab-saves').style.display = tab === 'saves' ? 'block' : 'none';
  document.getElementById('tab-archives').style.display = tab === 'archives' ? 'block' : 'none';
  if (tab === 'archives') loadArchives();
}

async function deleteCurrentGame() {
  if (!currentGame) return;
  if (!confirm(`确定要删除「${currentGame.name}」及其所有存档和文件吗？此操作不可撤销。`)) return;
  try {
    await api('DELETE', '/games/' + currentGame.id);
    closeModal('modal-detail');
    toast('游戏已删除', 'success');
    currentGame = null;
    await loadGames();
  } catch (e) {
    toast('删除失败: ' + e.message, 'error');
  }
}

/* ── Saves ────────────────────────────────────────────────────────────── */
function onSaveFilesSelected(input, mode) {
  const btn = document.getElementById('btn-upload-save');
  const list = document.getElementById('save-file-list');
  // Clear the other input so only one source is active
  if (mode === 'files') document.getElementById('input-save-folder').value = '';
  else document.getElementById('input-save-files').value = '';

  if (input.files.length > 0) {
    btn.disabled = false;
    if (mode === 'folder') {
      // Show folder name + count
      const folderName = input.files[0].webkitRelativePath.split('/')[0];
      list.innerHTML = `<span class="file-chip">📁 ${escHtml(folderName)} (${input.files.length} 个文件)</span>`;
    } else {
      list.innerHTML = Array.from(input.files).map(f =>
        `<span class="file-chip">📄 ${escHtml(f.name)}</span>`
      ).join('');
    }
  } else {
    btn.disabled = true;
    list.innerHTML = '';
  }
}

async function loadSaves() {
  if (!currentGame) return;
  const container = document.getElementById('saves-list');
  container.innerHTML = '<div class="loading-inline"><div class="spinner spinner-sm"></div></div>';
  try {
    const saves = await api('GET', '/games/' + currentGame.id + '/saves');
    renderSaves(saves);
  } catch (e) {
    container.innerHTML = `<div class="no-data">加载失败: ${escHtml(e.message)}</div>`;
  }
}

function renderSaves(saves) {
  const container = document.getElementById('saves-list');
  if (saves.length === 0) {
    container.innerHTML = '<div class="no-data">还没有存档，上传第一个存档吧</div>';
    return;
  }
  container.innerHTML = saves.map((s, i) => `
    <div class="save-item">
      <div class="save-item-info">
        <div class="save-item-time">
          ${i === 0 ? '<span class="save-badge">最新</span> ' : ''}
          ${escHtml(s.timestamp)}
        </div>
        ${s.label ? `<div class="save-item-label">💬 ${escHtml(s.label)}</div>` : ''}
        <div class="save-item-meta">
          <span>📁 ${s.files.length} 个文件</span>
          <span>💾 ${escHtml(s.size)}</span>
        </div>
      </div>
      <div class="save-item-actions">
        <a class="btn btn-ghost btn-sm" href="/api/games/${currentGame.id}/saves/${s.id}/download" download>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
          下载
        </a>
        <button class="btn btn-danger btn-sm" onclick="deleteSave('${s.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
            <path d="M10 11v6M14 11v6M9 6V4h6v2"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

async function uploadSave(e) {
  e.preventDefault();
  if (!currentGame) return;
  const filesInput = document.getElementById('input-save-files');
  const folderInput = document.getElementById('input-save-folder');
  const activeInput = folderInput.files.length > 0 ? folderInput : filesInput;
  if (!activeInput.files.length) { toast('请先选择文件', 'error'); return; }

  const label = document.getElementById('save-label').value.trim();
  const fd = new FormData();
  fd.append('label', label);
  for (const f of activeInput.files) {
    // Use webkitRelativePath to preserve folder structure, fall back to name
    const path = f.webkitRelativePath || f.name;
    fd.append('files', f, path);
  }

  showProgress('上传存档中...');
  try {
    await apiUpload('/games/' + currentGame.id + '/saves', fd, updateProgress);
    document.getElementById('form-save').reset();
    document.getElementById('input-save-folder').value = '';
    document.getElementById('save-file-list').innerHTML = '';
    document.getElementById('btn-upload-save').disabled = true;
    toast('存档上传成功', 'success');
    loadSaves();
    // Refresh badge count
    await loadGames();
    const updated = games.find(g => g.id === currentGame.id);
    if (updated) currentGame = updated;
  } catch (err) {
    toast('上传失败: ' + err.message, 'error');
  } finally {
    hideProgress();
  }
}

async function deleteSave(saveId) {
  if (!currentGame) return;
  if (!confirm('确定要删除这个存档吗？')) return;
  try {
    await api('DELETE', '/games/' + currentGame.id + '/saves/' + saveId);
    toast('存档已删除', 'success');
    loadSaves();
    loadGames();
  } catch (e) {
    toast('删除失败: ' + e.message, 'error');
  }
}

/* ── Archives ─────────────────────────────────────────────────────────── */
async function loadArchives() {
  if (!currentGame) return;
  const container = document.getElementById('archives-list');
  container.innerHTML = '<div class="loading-inline"><div class="spinner spinner-sm"></div></div>';
  try {
    const archives = await api('GET', '/games/' + currentGame.id + '/archives');
    renderArchives(archives);
  } catch (e) {
    container.innerHTML = `<div class="no-data">加载失败: ${escHtml(e.message)}</div>`;
  }
}

function renderArchives(archives) {
  const container = document.getElementById('archives-list');
  if (archives.length === 0) {
    container.innerHTML = '<div class="no-data">还没有上传游戏文件</div>';
    return;
  }
  container.innerHTML = archives.map(a => `
    <div class="archive-item">
      <div class="archive-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
          <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
      </div>
      <div class="archive-info">
        <div class="archive-name" title="${escHtml(a.name)}">${escHtml(a.name)}</div>
        <div class="archive-meta">${escHtml(a.size)} · ${escHtml(a.modified)}</div>
      </div>
      <div class="archive-actions">
        <a class="btn btn-primary btn-sm" href="/api/games/${currentGame.id}/archives/${encodeURIComponent(a.name)}/download" download>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
          </svg>
          下载
        </a>
        <button class="btn btn-danger btn-sm" onclick="deleteArchive('${escHtml(a.name)}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          </svg>
        </button>
      </div>
    </div>
  `).join('');
}

async function uploadArchive(input) {
  if (!currentGame || !input.files[0]) return;
  const fd = new FormData();
  fd.append('file', input.files[0]);
  showProgress(`上传「${input.files[0].name}」中...`);
  try {
    await apiUpload('/games/' + currentGame.id + '/archives', fd, updateProgress);
    toast('文件上传成功', 'success');
    loadArchives();
    loadGames();
  } catch (err) {
    toast('上传失败: ' + err.message, 'error');
  } finally {
    hideProgress();
    input.value = '';
  }
}

async function deleteArchive(name) {
  if (!currentGame) return;
  if (!confirm(`确定要删除「${name}」吗？`)) return;
  try {
    await api('DELETE', '/games/' + currentGame.id + '/archives/' + encodeURIComponent(name));
    toast('文件已删除', 'success');
    loadArchives();
    loadGames();
  } catch (e) {
    toast('删除失败: ' + e.message, 'error');
  }
}

/* ── Settings ─────────────────────────────────────────────────────────── */
async function openSettings() {
  try {
    const s = await api('GET', '/settings');
    document.getElementById('setting-max-saves').value = s.max_saves;
  } catch {}
  openModal('modal-settings');
}

async function saveSettings(e) {
  e.preventDefault();
  const maxSaves = parseInt(document.getElementById('setting-max-saves').value) || 3;
  try {
    await api('PUT', '/settings', { max_saves: maxSaves });
    closeModal('modal-settings');
    toast('设置已保存', 'success');
  } catch (err) {
    toast('保存失败: ' + err.message, 'error');
  }
}

/* ── Drag & Drop ──────────────────────────────────────────────────────── */
function setupDragDrop() {
  const zone = document.getElementById('save-drop-zone');
  if (!zone) return;

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length) {
      const input = document.getElementById('input-save-files');
      // DataTransfer trick to set files
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      input.files = dt.files;
      onSaveFilesSelected(input);
    }
  });
}
