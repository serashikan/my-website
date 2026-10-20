"""把现有前端按白名单复制到受保护的部署目录，不改原网页。"""
import json
import re
import shutil
import tempfile
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

ROOT_PAGES = {"index.html", "主页.html", "文学.html", "音乐.html", "数学.html", "技术.html", "塞拉.html", "米露.html"}
ROOT_SCRIPTS = {"鼠标.js", "花火.js", "站点内容.js", "site-pdf.js"}
ASSET_EXTENSIONS = {
    "图片": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".avif"},
    "字体": {".ttf", ".otf", ".woff", ".woff2"},
    "音频文件": {".mp4", ".m4a", ".mp3", ".ogg", ".wav", ".webm", ".jpg", ".png", ".webp"},
    "txt文件": {".txt", ".md", ".pdf"},
    "lib": {".js", ".mjs", ".wasm", ".bcmap", ".pfb", ".ttf", ".otf"},
    "miku": {".png", ".gif", ".webp"},
    "webmeji-main": {".js", ".css", ".png", ".gif", ".webp"},
}
INJECTION = ('\n<link rel="stylesheet" href="/static/members/site-nav.css">'
             '\n<script defer src="/static/members/site-nav.js"></script>\n')
QUESTIONS_INJECTION = ('\n<script>window.SERA_NATIVE_QUESTIONS = true;</script>'
                       '\n<link rel="stylesheet" href="/static/members/questions.css">'
                       '\n<script defer src="/static/members/questions.js"></script>\n')
CASINO_INJECTION = ('\n<link rel="stylesheet" href="/static/members/casino-account.css">'
                    '\n<script src="/static/members/casino-account.js"></script>\n')


def prepare_questions_page(html):
    """只转换 Mint 的生成副本，替换旧提问内容和初始化，不改静态版。"""
    if 'id="qa"' not in html:
        raise CommandError("塞拉页缺少问答容器，未生成部署副本。")
    html, section_count = re.subn(
        r'(<div id="qa" class="content">).*?(</div>\s*</main>)',
        r'\1<section class="qa-intro"><h2 class="qa-h">提问与回答</h2>'
        r'<p role="status">正在打开问答区……</p>'
        r'<noscript>请启用 JavaScript 后在这里提交问题。</noscript></section>\2',
        html, count=1, flags=re.S,
    )
    html, config_count = re.subn(
        r'// ={5,}\s*// 问答区配置.*?// 1\. 获取菜单里的链接',
        '// 1. 获取菜单里的链接', html, count=1, flags=re.S,
    )
    html, script_count = re.subn(
        r'// ={5,}\s*// 问答区\s*// ={5,}.*?(?=</script>)',
        'function ensureQA() {\n'
        '    if (window.SeraQuestions) window.SeraQuestions.mount(document.getElementById("qa"));\n'
        '}\n', html, count=1, flags=re.S,
    )
    if (section_count, config_count, script_count) != (1, 1, 1):
        raise CommandError("塞拉页问答结构已变化，未替换已有部署目录，请先更新转换规则。")
    return html.replace("</head>", QUESTIONS_INJECTION + "</head>", 1)


def allowed(path):
    if any(part.startswith(".") for part in path.parts):
        return False
    if len(path.parts) == 1:
        return (path.name in ROOT_PAGES or path.name in ROOT_SCRIPTS or path.suffix == ".css"
                or (path.suffix == ".js" and path.name.startswith(("game-", "casino-"))))
    top = path.parts[0]
    if top in ASSET_EXTENSIONS:
        return path.suffix.lower() in ASSET_EXTENSIONS[top]
    if top == "floriography 2":
        return ((path.parts[1] == "index.html" and len(path.parts) == 2)
                or (path.parts[1] in {"assets", "data"} and path.suffix.lower() in {
                    ".html", ".js", ".css", ".json", ".png", ".jpg", ".webp", ".svg"}))
    return False


def copy_site(source, target):
    manifest = []
    # 只遍历明确的前端目录，避免扫描虚拟环境和 Git。
    candidates = list(source.iterdir())
    for directory in (*ASSET_EXTENSIONS, "floriography 2"):
        root = source / directory
        if root.is_dir() and not root.is_symlink():
            candidates.extend(root.rglob("*"))
    for file in candidates:
        relative = file.relative_to(source)
        if not allowed(relative) or not file.is_file():
            continue
        if any(source.joinpath(*relative.parts[:i]).is_symlink() for i in range(1, len(relative.parts) + 1)):
            continue
        destination = target / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        if relative.name in ROOT_PAGES and len(relative.parts) == 1:
            html = file.read_text(encoding="utf-8")
            if relative.name == "塞拉.html":
                html = prepare_questions_page(html)
            if relative.name == "技术.html":
                html = html.replace("</head>", CASINO_INJECTION + "</head>", 1)
            destination.write_text(html.replace("</head>", INJECTION + "</head>", 1), encoding="utf-8")
        else:
            shutil.copy2(file, destination)
        manifest.append(relative.as_posix())
    return sorted(manifest)


class Command(BaseCommand):
    help = "从现有静态网站生成只供已登录用户访问的前端文件"

    def add_arguments(self, parser):
        parser.add_argument("--source", required=True, help="原网站根目录")

    def handle(self, *args, **options):
        source = Path(options["source"]).expanduser().resolve()
        if not (source / "主页.html").is_file() or not (source / "index.html").is_file():
            raise CommandError("源目录需要包含 index.html 和 主页.html")
        output = settings.PRIVATE_SITE_ROOT
        output.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix=".site-build-", dir=output.parent) as temp:
            prepared = Path(temp) / "site"
            prepared.mkdir()
            manifest = copy_site(source, prepared)
            if not ROOT_PAGES.issubset(set(manifest)):
                raise CommandError("缺少主站页面，未替换现有部署目录")
            if output.exists():
                output.rename(Path(temp) / "previous")
            prepared.rename(output)
        (output.parent / "site-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
        self.stdout.write(self.style.SUCCESS(f"已准备 {len(manifest)} 个网站文件；需重启服务后生效。"))
