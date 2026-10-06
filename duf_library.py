"""Bounded DSON pose reader and persistent, content-addressed DUF library."""
import base64
import gzip
import hashlib
import io
import json
import os
import re
import tempfile
from pathlib import Path

MAX_BYTES = 16 * 1024 * 1024
ID = re.compile(r"^[0-9a-f]{64}$")


def read_duf(raw):
    if len(raw) > MAX_BYTES:
        raise ValueError("DUF 文件超过 16MB")
    if raw[:2] == b"\x1f\x8b":
        with gzip.GzipFile(fileobj=io.BytesIO(raw)) as stream:
            raw = stream.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise ValueError("DUF 解压后超过 16MB")
    data = json.loads(raw.decode("utf-8-sig"))
    if not isinstance(data, dict):
        raise ValueError("DUF 顶层必须是对象")
    channels = {}
    translations = {}
    metadata = {}
    def values(items):
        return {item["id"]: item.get("current_value", item.get("value", 0)) for item in items if isinstance(item, dict) and item.get("id") in ("x", "y", "z")}
    for node in data.get("node_library", []) + data.get("scene", {}).get("nodes", []):
        name = node.get("name") or node.get("id", "")
        if not name:
            continue
        metadata[name] = {k: node[k] for k in ("rotation_order", "orientation", "center_point", "end_point") if k in node}
        if "rotation" in node:
            channels[name] = values(node["rotation"])
        if "translation" in node:
            translations[name] = values(node["translation"])
    targets = set()
    for animation in data.get("scene", {}).get("animations", []):
        from urllib.parse import unquote
        url = unquote(animation.get("url", ""))
        # Figure root and child channels share a single selector.
        match = re.fullmatch(r"name://([^/?#]+?)(?:/([^?]+?))?:?\?(rotation|translation)/([xyz])/value", url)
        if match:
            figure, bone, channel, axis = match.groups()
            name = bone.rstrip(":").split("/")[-1] if bone else "__figure__"
            targets.add("name://" + figure.rstrip(":"))
        else:
            match = re.search(r"(?:/|#)([^/#:?]+):?\?(rotation|translation)/([xyz])/value$", url)
            if not match:
                continue
            name, channel, axis = match.groups()
            targets.add(url[:match.start()])
        keys = animation.get("keys", [])
        if not keys:
            continue
        key = min(keys, key=lambda k: abs(float(k[0])))
        value = key[1]
        if not isinstance(value, (int, float)) or not (-100000 < value < 100000):
            raise ValueError("DUF 包含无效旋转值")
        (translations if channel == 'translation' else channels).setdefault(name, {})[axis] = value
    if len(targets) > 1:
        raise ValueError("文件包含多个人物，请在 DAZ 中另存单人姿势预设")
    if not channels:
        raise ValueError("未找到骨骼旋转；请导出 DAZ 姿势预设")
    # Reject NaN and malformed node values as well as animation values.
    for axes in [*channels.values(), *translations.values()]:
        if any(not isinstance(v, (int, float)) or not (-100000 < v < 100000) for v in axes.values()):
            raise ValueError("DUF 包含无效旋转值")
    return {"channels": channels, "translations": translations, "metadata": metadata, "asset": data.get("asset_info", {}).get("id", ""),
            "note": "使用时间 0 最近的姿势帧；保留整体及髋部位移（厘米），模型、材质和表情不导入。"}


class DufLibrary:
    def __init__(self, input_directory):
        self.folder = Path(input_directory) / "fisher_pose_3d"

    def path(self, key):
        if not ID.fullmatch(key):
            raise ValueError("无效图库编号")
        return self.folder / (key + ".json")

    def write(self, entry):
        self.folder.mkdir(parents=True, exist_ok=True)
        fd, temp = tempfile.mkstemp(dir=self.folder, suffix=".tmp")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(entry, f, ensure_ascii=False, allow_nan=False)
            os.replace(temp, self.path(entry["id"]))
        finally:
            if os.path.exists(temp):
                os.unlink(temp)

    def add(self, name, raw):
        if not name.lower().endswith(".duf"):
            raise ValueError("请选择 .duf 姿势文件")
        pose = read_duf(raw)
        key = hashlib.sha256(raw).hexdigest()
        if self.path(key).exists():
            return self.get(key)
        entry = {"id": key, "name": name.replace("\\", "/").split("/")[-1][:240],
                 "pose": pose, "source": base64.b64encode(raw).decode(), "thumbnail": None}
        self.write(entry)
        return entry

    def get(self, key):
        entry = json.loads(self.path(key).read_text(encoding="utf-8"))
        if entry.get('source') and 'translations' not in entry.get('pose', {}):
            entry['pose'] = read_duf(base64.b64decode(entry['source']))
            self.write(entry)
        return entry

    def save_scene(self, body):
        if not isinstance(body, dict):
            raise ValueError('无效动作场景')
        scene = body.get('scene')
        if not isinstance(scene, dict) or scene.get('kind') != 'vnccs-free-pose':
            raise ValueError('无效动作场景')
        characters = scene.get('characters', [])
        if not isinstance(characters, list) or not 1 <= len(characters) <= 3:
            raise ValueError('动作场景需要1–3个角色')
        slots = [c.get('slot') for c in characters if isinstance(c, dict)]
        if len(slots) != len(characters) or any(type(s) is not int or s not in range(1, 4) for s in slots) or len(set(slots)) != len(slots):
            raise ValueError('无效角色编号')
        mode = body.get('presetType')
        if mode not in ('character', 'scene') or (mode == 'character' and len(characters) != 1):
            raise ValueError('无效保存类型')
        encoded = json.dumps(scene, ensure_ascii=False, allow_nan=False).encode('utf-8')
        if len(encoded) > MAX_BYTES:
            raise ValueError('动作场景超过16MB')
        key = hashlib.sha256(mode.encode() + encoded).hexdigest()
        thumbnail = body.get('thumbnail')
        if thumbnail:
            self.validate_thumbnail(thumbnail)
        entry = {'id': key, 'name': str(body.get('name') or '未命名动作')[:120], 'scene': scene, 'presetType': mode, 'thumbnail': thumbnail or None}
        self.write(entry)
        return self.get(key)

    def listing(self):
        entries = []
        for path in sorted(self.folder.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True):
            try:
                item = self.get(path.stem)
                entries.append({k: item[k] for k in ("id", "name", "thumbnail")})
            except (ValueError, OSError, KeyError):
                continue
        return entries

    @staticmethod
    def validate_thumbnail(image):
        if not isinstance(image, str) or not image.startswith("data:image/png;base64,") or len(image) > 2_000_000:
            raise ValueError("无效缩略图")
        decoded = base64.b64decode(image.split(",", 1)[1], validate=True)
        if not decoded.startswith(b"\x89PNG\r\n\x1a\n"):
            raise ValueError("无效 PNG")

    def thumbnail(self, key, image):
        self.validate_thumbnail(image)
        entry = self.get(key)
        entry["thumbnail"] = image
        self.write(entry)

    def delete(self, key):
        self.path(key).unlink()


def register_routes():
    try:
        import folder_paths
        from aiohttp import web
        from server import PromptServer
        routes = PromptServer.instance.routes
    except (ImportError, AttributeError):
        return
    library = DufLibrary(folder_paths.get_input_directory())
    prefix = "/fisher_pose_3d/duf"

    async def handler(request):
        try:
            key = request.match_info.get("key")
            if request.method == "GET":
                if not key:
                    return web.json_response({"files": library.listing()})
                item = library.get(key)
                return web.json_response({k: v for k, v in item.items() if k != "source"})
            if request.method == "DELETE":
                library.delete(key)
                return web.json_response({"deleted": key})
            if request.method == "PUT":
                body = await request.json()
                library.thumbnail(key, body.get("thumbnail"))
                return web.json_response({"saved": key})
            if request.content_type == 'application/json':
                raw = bytearray()
                async for chunk in request.content.iter_chunked(65536):
                    raw.extend(chunk)
                    if len(raw) > MAX_BYTES:
                        raise ValueError('动作场景超过16MB')
                return web.json_response(library.save_scene(json.loads(raw)))
            # Stream multipart uploads: enforce limit even with chunked requests.
            reader = await request.multipart()
            part = await reader.next()
            if not part or part.name != "file":
                raise ValueError("缺少 DUF 文件")
            raw = bytearray()
            while True:
                chunk = await part.read_chunk()
                if not chunk:
                    break
                raw.extend(chunk)
                if len(raw) > MAX_BYTES:
                    raise ValueError("DUF 文件超过 16MB")
            item = library.add(part.filename or "", bytes(raw))
            return web.json_response({k: v for k, v in item.items() if k != "source"})
        except FileNotFoundError:
            return web.json_response({"error": "图库文件不存在"}, status=404)
        except (ValueError, TypeError, KeyError, AttributeError, IndexError, UnicodeError, EOFError, gzip.BadGzipFile) as error:
            return web.json_response({"error": "DUF 读取失败：" + str(error)}, status=400)
        except OSError:
            return web.json_response({"error": "图库读写失败，请检查磁盘空间和权限"}, status=500)
    routes.get(prefix)(handler)
    routes.post(prefix)(handler)
    routes.get(prefix + "/{key}")(handler)
    routes.put(prefix + "/{key}")(handler)
    routes.delete(prefix + "/{key}")(handler)
