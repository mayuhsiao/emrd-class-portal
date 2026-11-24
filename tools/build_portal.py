# -*- coding: utf-8 -*-
"""產生入口網站的素材：輪播照片、活動花絮、Logo 牆、影片與 js/portal-data.js。
（輪播開頭的 Logo 牆動畫另由 tools/logo_film/render.mjs 算圖）

用法（在專案根目錄）：python tools/build_portal.py
新增照片：放進「素材」資料夾後，把檔名關鍵字加到下方 HERO 或 GALLERY。
素材原圖不會被更動；輸出都在 assets/portal 與 assets/video。
"""
import csv
import json
import os
import re
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from photo_grade import load, grade, crop_frac, extend_bottom, soft_focus  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, '素材')
OUT = os.path.join(ROOT, 'assets', 'portal')
EVENT = '校友會 · 文山農場'

# 首頁輪播（16:9），依章節排列；film 是影片，其餘是照片。
# 裁切：cx, cy 中心、w 寬度比例；ox, oy 是緩慢推近時的焦點；ext 是畫面下方補長的比例。
# 文字壓在左下，所以人臉放在畫面上方六成；小朋友為主角的照片不放輪播。
# key 可加資料夾（例如 校友會/IMG_3270），避免不同資料夾有同名檔案。
FARM = '文山農場'
NTUST = '臺科大'
HERO = [
    dict(chapter='企業', film='logo-wall', title='EMRD 同學任職企業', meta='61 家企業 · 114–115 級', sec=14, ox=50, oy=30),

    dict(chapter='校友會', name='alumni-01', key='2026-10-20_0029', scene='outdoor', cx=.50, cy=.60, w=1.00, ox=50, oy=40, title='校友會大合照', meta=f'{FARM} · 2026.10.18', q=74, seed=1),
    dict(chapter='校友會', name='alumni-02', key='校友會/LINE_NOTE_251201_4', scene='outdoor', sky='grad', cx=.50, cy=.53, w=1.00, ox=50, oy=40, title='全國 EMBA 校園馬拉松接力賽', meta='第 13 屆 · 2025'),
    dict(chapter='校友會', name='alumni-03', key='校友會/IMG_0527', scene='outdoor', sky='grad', exposure=.14, cx=.53, cy=.69, w=.82, ext=.06, ox=52, oy=40, title='校慶繞場', meta='臺科大 114 年運動大會'),
    dict(chapter='校友會', name='alumni-04', key='校友會/IMG_3270', scene='shade', cx=.50, cy=.62, w=1.00, ext=.06, ox=52, oy=32, title='校友會烤肉', meta='高階科技研發碩士校友會'),
    dict(chapter='校友會', name='alumni-05', key='校友會/DSC_8897', scene='indoor', warmth=4.5, exposure=.06, cx=.50, cy=.613, w=.92, ox=52, oy=30, title='校友晚宴', meta='2024.03.23'),
    dict(chapter='校友會', name='alumni-06', key='校友會/IMG_0096', scene='indoor', cx=.50, cy=.578, w=1.00, ox=54, oy=34, title='EMRD 新生營', meta='高階科技研發碩士學位學程'),
    dict(chapter='校友會', name='alumni-07', key='校友會/PXL_20230813_065844311', scene='indoor', cx=.475, cy=.76, w=.86, ext=.20, ox=48, oy=36, title='新生營', meta='2023.08.13'),

    dict(chapter='臺科大', film='hero-bg', title='臺科大形象動畫', meta='NTUST · EMRD', sec=15, ox=50, oy=50),

    dict(chapter='課堂', name='class-01', key='上課畫面/IMG_3582', scene='indoor', cx=.50, cy=.634, w=.97, ox=52, oy=40, title='課堂合影', meta=f'{NTUST} · 2026.10.17'),
    dict(chapter='課堂', name='class-02', key='上課畫面/彭文彥老師', scene='indoor', cx=.50, cy=.472, w=1.00, ox=30, oy=34, title='彭文彥老師', meta=f'{NTUST} · 2026.11.19'),
    dict(chapter='課堂', name='class-03', key='上課畫面/IMG_3083', scene='indoor', cx=.50, cy=.535, w=1.00, ox=30, oy=38, title='課堂講授', meta=f'{NTUST} · 2026.09.12'),
    dict(chapter='課堂', name='class-04', key='上課畫面/IMG_3080', scene='indoor', cx=.535, cy=.629, w=.93, ox=54, oy=40, title='課堂合影', meta=f'{NTUST} · 2026.09.12'),
    dict(chapter='課堂', name='class-05', key='上課畫面/IMG_3589', scene='indoor', cx=.50, cy=.625, w=1.00, ox=72, oy=42, title='財務管理課堂', meta=f'{NTUST} · 2026.10.17'),
    dict(chapter='課堂', name='class-06', key='上課畫面/IMG_3082', scene='indoor', cx=.50, cy=.585, w=1.00, ox=42, oy=38, title='專注聽講', meta=f'{NTUST} · 2026.09.12'),
    dict(chapter='課堂', name='class-07', key='IMG_3131', scene='indoor', cx=.52, cy=.56, w=.98, ox=60, oy=42, title='課堂時光', meta=f'{NTUST} · 2026.09.17', seed=10),

    dict(chapter='文山農場', name='farm-01', key='2026-10-20_0020', scene='outdoor', cx=.50, cy=.42, w=1.00, ox=62, oy=55, title='文山農場林蔭道', meta=f'{FARM} · 2026.10.18', q=76, seed=2),
    dict(chapter='文山農場', name='farm-02', key='2026-10-20_0032', scene='outdoor', cx=.42, cy=.36, w=.84, ox=66, oy=38, title='相見歡', meta=f'{FARM} · 2026.10.18', seed=3),
    dict(chapter='文山農場', name='farm-03', key='AG5R7199', scene='outdoor', sky='grad', cx=.50, cy=.40, w=1.00, ox=58, oy=30, title='同行的夥伴', meta=f'{FARM} · 2026.10.18', seed=4),
    dict(chapter='文山農場', name='farm-04', key='2026-10-20_0024', scene='outdoor', cx=.36, cy=.40, w=.80, ox=62, oy=30, title='活動現場', meta=f'{FARM} · 2026.10.18', seed=5),
    dict(chapter='文山農場', name='farm-05', key='2026-10-20_0010', scene='shade', cx=.44, cy=.37, w=.90, ox=62, oy=36, title='笑聲不斷', meta=f'{FARM} · 2026.10.18', seed=6),
    dict(chapter='文山農場', name='farm-06', key='AG5R7277', scene='shade', cx=.52, cy=.40, w=1.00, ox=56, oy=32, title='涼亭下的相聚', meta=f'{FARM} · 2026.10.18', seed=7),
    dict(chapter='文山農場', name='farm-07', key='AG5R7215', scene='outdoor', sky='grad', cx=.44, cy=.57, w=.90, ox=62, oy=36, title='青山下的合影', meta=f'{FARM} · 2026.10.18', seed=8),
]
HERO_SEC = 5.5  # 每張照片停留秒數

# 投影幕上有學號、排行榜、講師履歷：網站是公開的，這些範圍做柔焦。
# [(柔焦範圍, 要保持清楚的人物輪廓), …]，座標為原圖寬高的比例。
SOFT_AREAS = {
    '上課畫面/彭文彥老師': [(
        [(.044, 0), (.197, 0), (.479, .230), (.482, .608), (.060, .774)],
        [(.2470, .327), (.2490, .299), (.2620, .281), (.2820, .2735), (.3020, .2715), (.3210, .279), (.3350, .296), (.3410, .314),
         (.3430, .331), (.3480, .343), (.3475, .362), (.3425, .366), (.3405, .381), (.3370, .401), (.3325, .424), (.3300, .435),
         (.3335, .444), (.3415, .459), (.3520, .468), (.3665, .486), (.3755, .513), (.3820, .537), (.3955, .559), (.4070, .588),
         (.4185, .606), (.4210, .631), (.4170, .652), (.4050, .670), (.3930, .673), (.3940, .699), (.3960, .860), (.3700, .920),
         (.2240, .920), (.2180, .900), (.2220, .825), (.2310, .775), (.2395, .740), (.2360, .696), (.2300, .667), (.2230, .617),
         (.2145, .601), (.2160, .550), (.2160, .509), (.2280, .478), (.2580, .446), (.2660, .425), (.2655, .408), (.2575, .389),
         (.2520, .362), (.2500, .345)],
    )],
    '上課畫面/IMG_3083': [([(.3140, .2670), (.6085, .2815), (.6080, .5745), (.3152, .5855)], None)],
    '上課畫面/IMG_3082': [([(.4132, .3495), (.6898, .3520), (.6873, .6238), (.4120, .6197)], None)],
}

# 背景已虛化的草地合照：用淡藍漸層取代天空遮罩，避免山稜出現硬邊
SOFT_SKY = {'AG5R7199', 'AG5R7198', 'AG5R7203', 'AG5R7204', 'AG5R7215', 'AG5R7219', 'AG5R7222', 'AG5R7224', 'AG5R7265', 'AG5R7267'}

# 活動花絮（已排除重複：_0 複本、與合照幾乎相同的 0030、以及 8月_6365 企業圖卡）
# 前面的會先顯示，其餘按「看全部」展開。
GALLERY = [
    ('2026-10-20_0029', 'outdoor'), ('2026-10-20_0032', 'outdoor'), ('AG5R7199', 'outdoor'), ('2026-10-20_0020', 'outdoor'),
    ('2026-10-20_0010', 'shade'), ('IMG_3581', 'indoor'), ('2026-10-20_0012', 'shade'), ('AG5R7277', 'shade'),
    ('IMG_3131', 'indoor'), ('AG5R7215', 'outdoor'), ('2026-10-20_0024', 'outdoor'), ('2026-10-20_0014', 'shade'),
    ('AG5R7247', 'shade'), ('AG5R7198', 'outdoor'), ('AG5R7280', 'shade'), ('2026-10-20_0016', 'outdoor'),
    ('2026-10-20_0022', 'shade'), ('AG5R7276', 'shade'), ('IMG_3555', 'indoor'), ('IMG_3619', 'indoor'),
    ('IMG_3079', 'indoor'), ('IMG_3556', 'indoor'), ('2026-10-20_0013', 'shade'), ('2026-10-20_0015', 'outdoor'),
    ('2026-10-20_0017', 'shade'), ('2026-10-20_0025', 'outdoor'), ('2026-10-20_0026', 'outdoor'), ('2026-10-20_0028', 'outdoor'),
    ('AG5R7251', 'outdoor'), ('2026-10-20_0005', 'shade'), ('AG5R7219', 'outdoor'), ('AG5R7224', 'outdoor'),
    ('AG5R7229', 'shade'), ('AG5R7234', 'shade'), ('AG5R7243', 'shade'), ('AG5R7265', 'outdoor'),
    ('AG5R7253', 'outdoor'), ('2026-10-20_0034', 'outdoor'), ('AG5R7239', 'shade'), ('AG5R7260', 'shade'),
    ('AG5R7274', 'shade'), ('AG5R7203', 'outdoor'), ('AG5R7204', 'outdoor'), ('AG5R7222', 'outdoor'),
    ('AG5R7227', 'shade'), ('AG5R7236', 'shade'), ('AG5R7237', 'shade'), ('AG5R7244', 'shade'),
    ('AG5R7249', 'shade'), ('AG5R7256', 'shade'), ('AG5R7267', 'outdoor'), ('AG5R7283', 'shade'),
    ('AG5R7285', 'shade'), ('2026-10-20_0035', 'outdoor'),
]
GALLERY_FIRST = 18  # 一開始顯示幾張

LOGO_FILE = {'CL Technology': 'cltech', 'JMEM TEK': 'jmem', 'Print2Finishing': 'print2', 'WT Microelectronics': 'wt'}


def walk_files(root):
    for d, _, fs in os.walk(root):
        for f in fs:
            yield os.path.join(d, f)


PHOTOS = [p for p in walk_files(SRC) if p.lower().endswith(('.jpg', '.jpeg', '.heic', '.png')) and 'LOGO' not in p.upper()]


def find_photo(key):
    """用檔名關鍵字找原圖（可寫成「資料夾/檔名」）；同一張有複本時取檔名最短的那份。"""
    folder, _, stem = key.rpartition('/')
    hits = [p for p in PHOTOS if stem in os.path.basename(p) and (not folder or os.path.basename(os.path.dirname(p)) == folder)]
    if not hits:
        raise SystemExit(f'找不到照片：{key}')
    return min(hits, key=lambda p: (len(os.path.basename(p)), p))


def shot_date(im):
    ex = im.getexif()
    sub = ex.get_ifd(0x8769) if ex else {}
    raw = sub.get(36867) or sub.get(36868) or ex.get(306) or ''
    m = re.match(r'(\d{4}):(\d{2}):(\d{2})', str(raw))
    return f'{m.group(1)}.{m.group(2)}.{m.group(3)}' if m else ''


def ensure(path):
    os.makedirs(path, exist_ok=True)
    return path


def save_webp(arr, path, q):
    Image.fromarray(arr).save(path, 'WEBP', quality=q, method=6)


def hero_image(h, size=(2400, 1350)):
    im = load(find_photo(h['key']))
    if h['key'] in SOFT_AREAS:
        im = soft_focus(im, SOFT_AREAS[h['key']])
    if h.get('ext'):  # cy 一律以補長前的高度計算
        before = im.height
        im = extend_bottom(im, h['ext'])
        h = dict(h, cy=h['cy'] * before / im.height)
    return crop_frac(im, h['cx'], h['cy'], h['w'], 16 / 9).resize(size, Image.LANCZOS)


def build_hero():
    out, data = ensure(os.path.join(OUT, 'hero')), []
    for i, h in enumerate(HERO, 1):
        item = dict(chapter=h['chapter'], title=h['title'], meta=h['meta'], ox=h['ox'], oy=h['oy'])
        if 'film' in h:
            item.update(type='film', key=h['film'], src=f"assets/video/{h['film']}.mp4", sec=h['sec'])
            if h['film'] == 'logo-wall':  # 由 tools/logo_film/render.mjs 算圖；直式螢幕用另一支
                item.update(poster='assets/portal/logo-wall-poster.webp', srcM='assets/video/logo-wall-m.mp4',
                            posterM='assets/portal/logo-wall-poster-m.webp')
            else:
                item.update(poster='assets/portal/film-first.webp')
            data.append(item)
            continue
        name = h['name'] + '.webp'
        arr = grade(np.asarray(hero_image(h)), scene=h['scene'], sky=h.get('sky'), exposure=h.get('exposure', 0.0),
                    warmth=h.get('warmth', 0.0), seed=h.get('seed', 100 + i))
        save_webp(arr, os.path.join(out, name), h.get('q', 80))
        item.update(type='img', src=f'assets/portal/hero/{name}', sec=HERO_SEC)
        data.append(item)
        print('hero', name, h['key'], flush=True)
    keep = {h['name'] + '.webp' for h in HERO if 'name' in h}
    for f in os.listdir(out):  # 清掉已不在清單上的舊輪播圖
        if f not in keep:
            os.remove(os.path.join(out, f))
    return data


def build_gallery():
    out, data = ensure(os.path.join(OUT, 'gallery')), []
    for i, (key, scene) in enumerate(GALLERY, 1):
        path = find_photo(key)
        date = shot_date(Image.open(path))
        im = load(path)
        im.thumbnail((2000, 2000), Image.LANCZOS)
        arr = grade(np.asarray(im), scene=scene, sky='grad' if key in SOFT_SKY else None, seed=100 + i)
        graded = Image.fromarray(arr)
        full, thumb = f'g{i:02d}.webp', f'g{i:02d}_t.webp'
        graded.save(os.path.join(out, full), 'WEBP', quality=82, method=6)
        small = graded.copy()
        small.thumbnail((760, 760), Image.LANCZOS)
        small.save(os.path.join(out, thumb), 'WEBP', quality=74, method=6)
        kind = 'class' if scene == 'indoor' else 'event'
        data.append(dict(full=f'assets/portal/gallery/{full}', thumb=f'assets/portal/gallery/{thumb}',
                         w=small.width, h=small.height, kind=kind,
                         cap=('課堂時光' if kind == 'class' else EVENT), date=date))
        print('gallery', full, os.path.basename(path), date, flush=True)
    return data


def build_logos():
    src_dir = os.path.dirname(next(p for p in walk_files(SRC) if p.endswith('adata.png')))
    csv_path = os.path.join(os.path.dirname(src_dir), 'logo_list.csv')
    out, data = ensure(os.path.join(OUT, 'logos')), []
    with open(csv_path, encoding='utf-8-sig', newline='') as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        brand, company = r['品牌'].strip(), r['公司'].strip()
        stem = LOGO_FILE.get(brand) or re.sub(r'[^a-z0-9]', '', brand.lower())
        path = os.path.join(src_dir, stem + '.png')
        if not os.path.exists(path):  # 官方 Logo 待補：以文字顯示（與原本的 Logo 牆一致）
            data.append(dict(name=company, text=True))
            print('text-only', company, flush=True)
            continue
        im = Image.open(path).convert('RGBA')
        a = np.asarray(im)
        ink = (a[..., 3] > 16) & (a[..., :3].min(axis=2) < 243)  # 非透明且非白底
        ys, xs = np.where(ink)
        if xs.size:
            m = 2
            box = (max(xs.min() - m, 0), max(ys.min() - m, 0), min(xs.max() + m + 1, im.width), min(ys.max() + m + 1, im.height))
            im = im.crop(box)
        name = stem + '.png'
        im.save(os.path.join(out, name), optimize=True)
        # 面積一致：讓細長與方形的 Logo 視覺份量接近（以 3:2 磚塊的比例計算）
        ar = im.width / im.height
        tw, th, area = 150.0, 100.0, 3400.0
        w = (area * ar) ** 0.5
        h = w / ar
        scale = min(1.0, tw * .80 / w, th * .64 / h)
        data.append(dict(name=f'{brand} {company}' if brand != company else company, src=f'assets/portal/logos/{name}', w=round(w * scale / tw * 100, 1)))
    print('logos', len(data), flush=True)
    return data


def build_video():
    vid_dir = ensure(os.path.join(ROOT, 'assets', 'video'))
    src = os.path.join(SRC, 'hero-bg.mp4')
    shutil.copyfile(src, os.path.join(vid_dir, 'hero-bg.mp4'))
    stills = {'film-first.webp': '0', 'film-poster.webp': '13.1', 'film-traces.webp': '3.8', 'film-wafer.webp': '8.6'}
    ensure(OUT)
    for name, t in stills.items():
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-ss', t, '-i', src, '-frames:v', '1', '-q:v', '82',
                        os.path.join(OUT, name)], check=True)
    print('video + stills', flush=True)


def main():
    only = set(sys.argv[1:])  # 可只重跑部分：hero gallery logos video
    data_path = os.path.join(ROOT, 'js', 'portal-data.js')
    data = {}
    if os.path.exists(data_path):
        data = json.loads(open(data_path, encoding='utf-8').read().split('=', 1)[1].rstrip().rstrip(';'))
    if not only or 'video' in only:
        build_video()
    if not only or 'hero' in only:
        data['hero'] = build_hero()
        data.pop('heroFilmAfter', None)
    if not only or 'gallery' in only:
        data['gallery'] = build_gallery()
        data['galleryFirst'] = GALLERY_FIRST
    if not only or 'logos' in only:
        data['logos'] = build_logos()
    with open(data_path, 'w', encoding='utf-8') as f:
        f.write('/* 由 tools/build_portal.py 產生，請勿手動修改 */\nwindow.PORTAL = ' + json.dumps(data, ensure_ascii=False, indent=1) + ';\n')
    print('done:', {k: len(v) for k, v in data.items() if isinstance(v, list)})


if __name__ == '__main__':
    main()
