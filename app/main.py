import os
import json
import shutil
import uuid
import zipfile
import io
from datetime import datetime, timezone, timedelta
from functools import wraps
from pathlib import Path

from flask import Flask, request, jsonify, send_file, render_template, send_from_directory, session, redirect, url_for
from flask_cors import CORS
from PIL import Image
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
CORS(app)
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024 * 1024  # 10GB

DATA_DIR = Path('/data')
APP_DIR = Path('/app')
GAMES_DIR = DATA_DIR / 'games'
SETTINGS_FILE = DATA_DIR / 'settings.json'
PASSWORD_FILE = APP_DIR / 'password.txt'

GAMES_DIR.mkdir(parents=True, exist_ok=True)

DEFAULT_SETTINGS = {
    'max_saves': 3
}

# 东八区时区 (UTC+8)
TZ_CST = timezone(timedelta(hours=8))


# ── 密码初始化 ─────────────────────────────────────────────────────────────────

def init_password():
    """启动时若无密码文件则自动生成初始密码 123456。"""
    if not PASSWORD_FILE.exists():
        PASSWORD_FILE.write_text(generate_password_hash('123456'))


init_password()
app.secret_key = os.urandom(32)


# ── 登录保护 ───────────────────────────────────────────────────────────────────

def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            if request.path.startswith('/api/'):
                return jsonify({'error': 'Unauthorized'}), 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated


@app.route('/login', methods=['GET', 'POST'])
def login_page():
    if session.get('logged_in'):
        return redirect(url_for('index'))
    error = None
    if request.method == 'POST':
        pw = request.form.get('password', '')
        stored_hash = PASSWORD_FILE.read_text().strip()
        if check_password_hash(stored_hash, pw):
            session['logged_in'] = True
            return redirect(url_for('index'))
        error = '密码错误，请重试'
    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login_page'))


@app.route('/api/change-password', methods=['POST'])
@login_required
def api_change_password():
    data = request.get_json()
    old_pw = data.get('old_password', '')
    new_pw = data.get('new_password', '').strip()
    if not new_pw:
        return jsonify({'error': '新密码不能为空'}), 400
    stored_hash = PASSWORD_FILE.read_text().strip()
    if not check_password_hash(stored_hash, old_pw):
        return jsonify({'error': '当前密码错误'}), 400
    PASSWORD_FILE.write_text(generate_password_hash(new_pw))
    return jsonify({'ok': True})


# ── Helpers ────────────────────────────────────────────────────────────────────

def get_cst_now():
    """Get current time in China Standard Time (UTC+8)"""
    return datetime.now(TZ_CST)


def load_settings():
    if SETTINGS_FILE.exists():
        with open(SETTINGS_FILE) as f:
            return {**DEFAULT_SETTINGS, **json.load(f)}
    return DEFAULT_SETTINGS.copy()


def save_settings(settings):
    with open(SETTINGS_FILE, 'w') as f:
        json.dump(settings, f, indent=2)


def get_game_dir(game_id):
    return GAMES_DIR / game_id


def get_saves_dir(game_id):
    return get_game_dir(game_id) / 'saves'


def get_archives_dir(game_id):
    return get_game_dir(game_id) / 'archives'


def get_game_info(game_id):
    info_file = get_game_dir(game_id) / 'info.json'
    if info_file.exists():
        with open(info_file) as f:
            return json.load(f)
    return None


def save_game_info(game_id, info):
    with open(get_game_dir(game_id) / 'info.json', 'w') as f:
        json.dump(info, f, indent=2, ensure_ascii=False)


def format_size(size_bytes):
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024:
            return f"{size_bytes:.1f} {unit}"
        size_bytes /= 1024
    return f"{size_bytes:.1f} TB"


def dir_size(path):
    total = 0
    for f in Path(path).rglob('*'):
        if f.is_file():
            total += f.stat().st_size
    return total


def list_saves(game_id):
    saves_dir = get_saves_dir(game_id)
    if not saves_dir.exists():
        return []
    saves = []
    for save_dir in saves_dir.iterdir():
        if not save_dir.is_dir():
            continue
        info_file = save_dir / 'save_info.json'
        info = {}
        if info_file.exists():
            with open(info_file) as f:
                info = json.load(f)
        files = [f.name for f in save_dir.iterdir() if f.name != 'save_info.json']
        size = sum(f.stat().st_size for f in save_dir.rglob('*') if f.is_file() and f.name != 'save_info.json')
        saves.append({
            'id': save_dir.name,
            'timestamp': info.get('timestamp', save_dir.name),
            'timestamp_raw': info.get('timestamp_raw', 0),
            'label': info.get('label', ''),
            'files': files,
            'size': format_size(size)
        })
    saves.sort(key=lambda x: x['timestamp_raw'], reverse=True)
    return saves


def cleanup_old_saves(game_id):
    settings = load_settings()
    max_saves = settings.get('max_saves', 3)
    saves = list_saves(game_id)
    if len(saves) > max_saves:
        saves_dir = get_saves_dir(game_id)
        for save in saves[max_saves:]:
            shutil.rmtree(saves_dir / save['id'], ignore_errors=True)


def extract_exe_icon(file_path):
    """Extract icon from .exe file, return PNG bytes or None."""
    try:
        import icoextract
        extractor = icoextract.IconExtractor(file_path)
        icon_data = extractor.get_icon()
        # get_icon() returns an io.BytesIO object
        img = Image.open(icon_data)
        # Get largest size
        sizes = img.info.get('sizes', [(img.width, img.height)])
        if hasattr(img, 'n_frames') and img.n_frames > 1:
            best = None
            best_size = 0
            for i in range(img.n_frames):
                img.seek(i)
                size = img.width * img.height
                if size > best_size:
                    best_size = size
                    best = img.copy().convert('RGBA')
            img = best
        else:
            img = img.convert('RGBA')
        # Resize to 128x128
        img = img.resize((128, 128), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return buf.getvalue()
    except Exception as e:
        print(f"Icon extraction failed: {e}")
        return None


# ── Routes ────────────────────────────────────────────────────────────────────

@app.route('/')
@login_required
def index():
    return render_template('index.html')


@app.route('/api/settings', methods=['GET'])
@login_required
def api_get_settings():
    return jsonify(load_settings())


@app.route('/api/settings', methods=['PUT'])
@login_required
def api_save_settings():
    data = request.get_json()
    settings = load_settings()
    if 'max_saves' in data:
        settings['max_saves'] = max(1, int(data['max_saves']))
    save_settings(settings)
    return jsonify(settings)


@app.route('/api/games', methods=['GET'])
@login_required
def api_list_games():
    games = []
    if GAMES_DIR.exists():
        for game_dir in GAMES_DIR.iterdir():
            if game_dir.is_dir():
                info = get_game_info(game_dir.name)
                if info:
                    saves = list_saves(game_dir.name)
                    archives = []
                    arch_dir = get_archives_dir(game_dir.name)
                    if arch_dir.exists():
                        archives = [f.name for f in arch_dir.iterdir() if f.is_file()]
                    games.append({**info, 'saves_count': len(saves), 'archives_count': len(archives)})
    games.sort(key=lambda g: g.get('name', '').lower())
    return jsonify(games)


@app.route('/api/games', methods=['POST'])
@login_required
def api_add_game():
    name = request.form.get('name', '').strip()
    if not name:
        return jsonify({'error': 'Name is required'}), 400

    game_id = str(uuid.uuid4())
    game_dir = get_game_dir(game_id)
    game_dir.mkdir(parents=True)
    get_saves_dir(game_id).mkdir()
    get_archives_dir(game_id).mkdir()

    has_icon = False

    # Try exe file first
    exe_file = request.files.get('exe_file')
    if exe_file and exe_file.filename:
        tmp_path = game_dir / 'tmp_exe'
        exe_file.save(str(tmp_path))
        icon_bytes = extract_exe_icon(str(tmp_path))
        tmp_path.unlink(missing_ok=True)
        if icon_bytes:
            with open(game_dir / 'icon.png', 'wb') as f:
                f.write(icon_bytes)
            has_icon = True

    # Try icon image file
    if not has_icon:
        icon_file = request.files.get('icon_file')
        if icon_file and icon_file.filename:
            try:
                img = Image.open(icon_file.stream).convert('RGBA')
                img.thumbnail((128, 128), Image.LANCZOS)
                img.save(str(game_dir / 'icon.png'), format='PNG')
                has_icon = True
            except Exception as e:
                print(f"Icon image processing failed: {e}")

    info = {
        'id': game_id,
        'name': name,
        'has_icon': has_icon,
        'created_at': get_cst_now().isoformat()
    }
    save_game_info(game_id, info)
    return jsonify(info), 201


@app.route('/api/games/<game_id>', methods=['PUT'])
@login_required
def api_update_game(game_id):
    info = get_game_info(game_id)
    if not info:
        return jsonify({'error': 'Game not found'}), 404

    name = request.form.get('name', '').strip()
    if name:
        info['name'] = name

    game_dir = get_game_dir(game_id)

    exe_file = request.files.get('exe_file')
    if exe_file and exe_file.filename:
        tmp_path = game_dir / 'tmp_exe'
        exe_file.save(str(tmp_path))
        icon_bytes = extract_exe_icon(str(tmp_path))
        tmp_path.unlink(missing_ok=True)
        if icon_bytes:
            with open(game_dir / 'icon.png', 'wb') as f:
                f.write(icon_bytes)
            info['has_icon'] = True

    icon_file = request.files.get('icon_file')
    if icon_file and icon_file.filename:
        try:
            img = Image.open(icon_file.stream).convert('RGBA')
            img.thumbnail((128, 128), Image.LANCZOS)
            img.save(str(game_dir / 'icon.png'), format='PNG')
            info['has_icon'] = True
        except Exception as e:
            print(f"Icon image processing failed: {e}")

    save_game_info(game_id, info)
    return jsonify(info)


@app.route('/api/games/<game_id>', methods=['DELETE'])
@login_required
def api_delete_game(game_id):
    game_dir = get_game_dir(game_id)
    if not game_dir.exists():
        return jsonify({'error': 'Game not found'}), 404
    shutil.rmtree(game_dir)
    return jsonify({'ok': True})


@app.route('/api/games/<game_id>/icon')
@login_required
def api_game_icon(game_id):
    icon_path = get_game_dir(game_id) / 'icon.png'
    if icon_path.exists():
        return send_file(str(icon_path), mimetype='image/png')
    # Return default icon
    default = Path(__file__).parent / 'static' / 'icons' / 'default.png'
    if default.exists():
        return send_file(str(default), mimetype='image/png')
    return '', 404


# ── Saves ─────────────────────────────────────────────────────────────────────

@app.route('/api/games/<game_id>/saves', methods=['GET'])
@login_required
def api_list_saves(game_id):
    if not get_game_dir(game_id).exists():
        return jsonify({'error': 'Game not found'}), 404
    return jsonify(list_saves(game_id))


@app.route('/api/games/<game_id>/saves', methods=['POST'])
@login_required
def api_upload_save(game_id):
    if not get_game_dir(game_id).exists():
        return jsonify({'error': 'Game not found'}), 404

    label = request.form.get('label', '').strip()
    files = request.files.getlist('files')
    if not files or not any(f.filename for f in files):
        return jsonify({'error': 'No files uploaded'}), 400

    now = get_cst_now()
    save_id = now.strftime('%Y%m%d_%H%M%S')
    saves_dir = get_saves_dir(game_id)
    save_dir = saves_dir / save_id
    save_dir.mkdir(parents=True, exist_ok=True)

    for file in files:
        if not file.filename:
            continue
        # Preserve relative path for folder uploads (webkitRelativePath)
        rel = file.filename.replace('\\', '/')
        # Strip leading slashes / drive letters to prevent path traversal
        rel = rel.lstrip('/')
        dest = (save_dir / rel).resolve()
        if not str(dest).startswith(str(save_dir.resolve())):
            continue  # skip any path traversal attempt
        dest.parent.mkdir(parents=True, exist_ok=True)
        file.save(str(dest))

    info = {
        'timestamp': now.strftime('%Y-%m-%d %H:%M:%S'),
        'timestamp_raw': now.timestamp(),
        'label': label
    }
    with open(save_dir / 'save_info.json', 'w') as f:
        json.dump(info, f)

    cleanup_old_saves(game_id)
    return jsonify({'id': save_id, **info}), 201


@app.route('/api/games/<game_id>/saves/<save_id>', methods=['DELETE'])
@login_required
def api_delete_save(game_id, save_id):
    save_dir = get_saves_dir(game_id) / save_id
    if not save_dir.exists():
        return jsonify({'error': 'Save not found'}), 404
    shutil.rmtree(save_dir)
    return jsonify({'ok': True})


@app.route('/api/games/<game_id>/saves/<save_id>/download')
@login_required
def api_download_save(game_id, save_id):
    save_dir = get_saves_dir(game_id) / save_id
    if not save_dir.exists():
        return jsonify({'error': 'Save not found'}), 404

    info = get_game_info(game_id)
    game_name = info['name'] if info else game_id

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        for f in save_dir.rglob('*'):
            if f.name == 'save_info.json' and f.parent == save_dir:
                continue
            if f.is_file():
                zf.write(f, f.relative_to(save_dir))
    buf.seek(0)

    safe_name = "".join(c for c in game_name if c.isalnum() or c in (' ', '-', '_')).strip()
    filename = f"{safe_name}_{save_id}.zip"
    return send_file(buf, mimetype='application/zip',
                     as_attachment=True, download_name=filename)


# ── Archives ──────────────────────────────────────────────────────────────────

@app.route('/api/games/<game_id>/archives', methods=['GET'])
@login_required
def api_list_archives(game_id):
    if not get_game_dir(game_id).exists():
        return jsonify({'error': 'Game not found'}), 404
    arch_dir = get_archives_dir(game_id)
    archives = []
    if arch_dir.exists():
        for f in arch_dir.iterdir():
            if f.is_file():
                archives.append({
                    'name': f.name,
                    'size': format_size(f.stat().st_size),
                    'modified': datetime.fromtimestamp(f.stat().st_mtime, tz=TZ_CST).strftime('%Y-%m-%d %H:%M:%S')
                })
    archives.sort(key=lambda x: x['name'])
    return jsonify(archives)


@app.route('/api/games/<game_id>/archives', methods=['POST'])
@login_required
def api_upload_archive(game_id):
    if not get_game_dir(game_id).exists():
        return jsonify({'error': 'Game not found'}), 404
    file = request.files.get('file')
    if not file or not file.filename:
        return jsonify({'error': 'No file uploaded'}), 400

    arch_dir = get_archives_dir(game_id)
    arch_dir.mkdir(exist_ok=True)
    dest = arch_dir / file.filename
    file.save(str(dest))
    return jsonify({'name': file.filename, 'size': format_size(dest.stat().st_size)}), 201


@app.route('/api/games/<game_id>/archives/<filename>', methods=['DELETE'])
@login_required
def api_delete_archive(game_id, filename):
    arch_path = get_archives_dir(game_id) / filename
    if not arch_path.exists():
        return jsonify({'error': 'Archive not found'}), 404
    arch_path.unlink()
    return jsonify({'ok': True})


@app.route('/api/games/<game_id>/archives/<filename>/download')
@login_required
def api_download_archive(game_id, filename):
    arch_dir = get_archives_dir(game_id)
    arch_path = arch_dir / filename
    if not arch_path.exists():
        return jsonify({'error': 'Archive not found'}), 404
    return send_file(str(arch_path), as_attachment=True, download_name=filename)


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
