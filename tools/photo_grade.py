# -*- coding: utf-8 -*-
"""EMRD 入口網站：活動照片後製（白平衡、曝光、天空救回、品牌調色、銳化）。

所有調整都只作用在輸出檔，素材原圖不會被更動。
需要：pip install pillow opencv-python numpy pillow-heif
"""
import numpy as np
import cv2
from PIL import Image, ImageOps
import pillow_heif

pillow_heif.register_heif_opener()

# 場景預設：wb 白平衡強度、target 中間調目標亮度、clarity 局部對比、sky 是否救回過曝天空
SCENES = {
    'outdoor': {'wb': 0.45, 'target': 0.49, 'clarity': 0.16, 'fill': 0.34, 'sky': True},
    'shade': {'wb': 0.45, 'target': 0.48, 'clarity': 0.16, 'fill': 0.38, 'sky': False},  # 涼亭內，背景亮、人在陰影
    'indoor': {'wb': 0.80, 'target': 0.52, 'clarity': 0.12, 'fill': 0.20, 'sky': False},  # 教室日光燈
}

# 底片感色調曲線：暗部微微墊高、亮部柔和收尾，不讓白色死白
CURVE_X = [0.00, 0.08, 0.22, 0.50, 0.75, 0.90, 1.00]
CURVE_Y = [0.020, 0.082, 0.218, 0.520, 0.785, 0.912, 0.975]


def load(path):
    return ImageOps.exif_transpose(Image.open(path)).convert('RGB')


def smooth_band(x, lo, hi, soft):
    """lo~hi 之間為 1，兩端以 soft 寬度平滑淡出。"""
    up = np.clip((x - (lo - soft)) / soft, 0, 1)
    dn = np.clip(((hi + soft) - x) / soft, 0, 1)
    up = up * up * (3 - 2 * up)
    dn = dn * dn * (3 - 2 * dn)
    return up * dn


def sky_mask(L, chroma):
    """找出與畫面上緣相連的過曝區域（天空），回傳柔化遮罩與天空下緣高度。"""
    H, W = L.shape
    raw = ((L > 90.0) & (chroma < 12.0)).astype(np.uint8)
    raw[int(H * 0.72):, :] = 0  # 天空不會出現在畫面下方，避免誤傷路面與白衣服
    n, labels = cv2.connectedComponents(raw, connectivity=8)
    if n <= 1:
        return None, 0
    top = np.unique(labels[: max(2, H // 120), :])
    top = top[top != 0]
    if top.size == 0:
        return None, 0
    mask = np.isin(labels, top)
    share = mask.mean()
    if share < 0.004:
        return None, 0
    rows = np.where(mask.any(axis=1))[0]
    horizon = int(rows.max()) if rows.size else 0
    soft = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), sigmaX=max(1.2, W / 1400))
    return soft, horizon


def sky_layer(H, W, horizon, seed):
    """產生乾淨柔和的藍天漸層（當天實際是藍天，只是相機拍到過曝），只帶極淡的橫向薄雲。"""
    rng = np.random.default_rng(seed)
    t = np.clip(np.arange(H, dtype=np.float32) / max(horizon, 1), 0, 1)[:, None]
    top = np.array([0.56, 0.71, 0.91], np.float32)
    low = np.array([0.88, 0.93, 0.975], np.float32)
    grad = top[None, None, :] * (1 - t[..., None] ** 1.15) + low[None, None, :] * (t[..., None] ** 1.15)
    grad = np.repeat(grad, W, axis=1)
    cloud = np.zeros((H, W), np.float32)
    for rows, cols, amp in ((14, 4, 1.0), (30, 7, 0.5)):  # 列多欄少 = 橫向拉長的薄雲
        n = rng.random((rows, cols), dtype=np.float32)
        cloud += amp * cv2.resize(n, (W, H), interpolation=cv2.INTER_CUBIC)
    cloud = (cloud - cloud.min()) / max(cloud.max() - cloud.min(), 1e-5)
    cloud = np.clip((cloud - 0.45) / 0.5, 0, 1)
    return grad * (1 - cloud[..., None] * 0.30) + cloud[..., None] * 0.30


def skin_weight(rgb):
    """膚色範圍（0~1）。銳化與局部對比避開這裡，人像才不會顯得粗糙。"""
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    h, s, v = cv2.split(hsv)
    w = smooth_band(h, 6, 40, 8) * smooth_band(s, 0.16, 0.66, 0.08) * np.clip((v - 0.22) / 0.2, 0, 1)
    return cv2.GaussianBlur(w, (0, 0), sigmaX=max(1.0, max(rgb.shape[:2]) / 1200))


def grade(rgb_u8, scene='outdoor', exposure=0.0, sky=None, warmth=0.0, seed=7):
    """rgb_u8: HxWx3 uint8。回傳調色後的 uint8。

    sky：True 救回過曝天空（遮罩，適合清楚的樹梢邊緣）；'grad' 只在上方亮部帶一層淡藍漸層
    （適合背景已虛化的合照，不會出現硬邊）；False 不處理。
    """
    p = SCENES[scene]
    use_sky = p['sky'] if sky is None else sky
    rgb = np.asarray(rgb_u8, np.float32) / 255.0
    H, W = rgb.shape[:2]
    skin0 = skin_weight(rgb)

    lab = cv2.cvtColor(rgb, cv2.COLOR_RGB2LAB)
    L0, a, b = cv2.split(lab)
    chroma0 = np.hypot(a, b)

    # 1. 白平衡：只看中間調的中性色，避免被草地、藍衣服帶偏
    neutral = (L0 > 28) & (L0 < 88) & (chroma0 < 20)
    if neutral.mean() > 0.015:
        a = a - p['wb'] * float(np.median(a[neutral]))
        b = b - p['wb'] * float(np.median(b[neutral]))
    b = b + warmth

    # 2. 黑白點與中間調（幅度有上限，不改變照片原本的氣氛）
    l = L0 / 100.0
    bp, wp = np.percentile(l, [0.4, 99.7])
    bp, wp = min(float(bp), 0.05), max(float(wp), 0.92)
    l = np.clip((l - bp) / (wp - bp), 0, 1)
    med = float(np.median(l))
    gamma = float(np.clip(np.log(p['target']) / np.log(max(med, 1e-3)), 0.80, 1.22))
    l = l ** gamma
    if exposure:
        l = np.clip(l * (2.0 ** exposure), 0, 1)

    # 3. 補光：把逆光、陰影裡的人臉拉出來（依周圍亮度，黑衣服不會變灰）
    wide = cv2.GaussianBlur(l, (0, 0), sigmaX=max(H, W) / 40)
    l = np.clip(l + p['fill'] * (1 - wide) ** 2 * (l ** 0.7) * (1 - l), 0, 1)

    # 局部對比（只作用在中間調，並避開皮膚，人臉不會變髒）
    blur = cv2.GaussianBlur(l, (0, 0), sigmaX=max(H, W) / 64)
    l = np.clip(l + p['clarity'] * (1 - 0.85 * skin0) * (l - blur) * (1 - np.abs(2 * l - 1) ** 2.2), 0, 1)

    # 輕柔膚：保邊平滑只淡淡疊在皮膚上，五官與皺紋的輪廓都還在
    d = max(5, int(max(H, W) / 300)) | 1
    smooth = cv2.bilateralFilter(l, d, 0.06, d)
    l = l * (1 - 0.42 * skin0) + smooth * (0.42 * skin0)

    # 4. 底片感色調曲線
    l = np.interp(l, CURVE_X, CURVE_Y).astype(np.float32)

    # 色彩隨明暗略微收斂，避免暗部過飽和
    lab2 = cv2.merge([l * 100.0, a, b])
    out = np.clip(cv2.cvtColor(lab2, cv2.COLOR_LAB2RGB), 0, 1)

    # 5. 選擇性色彩：草木降飽和偏深綠、藍色貼近校色；膚色不動
    hsv = cv2.cvtColor(out, cv2.COLOR_RGB2HSV)
    h, s, v = cv2.split(hsv)
    green = smooth_band(h, 62, 150, 22) * np.clip(s * 3, 0, 1)
    yellow = smooth_band(h, 42, 62, 8) * np.clip(s * 3, 0, 1)
    blue = smooth_band(h, 205, 245, 14) * np.clip(s * 3, 0, 1)
    h = (h + 9.0 * green + 4.0 * yellow) % 360
    s = np.clip(s * (1 - 0.26 * green) * (1 - 0.16 * yellow) * (1 + 0.05 * blue), 0, 1)
    v = np.clip(v * (1 - 0.10 * green) * (1 - 0.04 * yellow), 0, 1)
    skin = smooth_band(h, 8, 42, 8) * smooth_band(s, 0.14, 0.70, 0.08)
    out = np.clip(cv2.cvtColor(cv2.merge([h, s, v]), cv2.COLOR_HSV2RGB), 0, 1)

    # 6. 救回過曝天空：以「色彩增值」疊上藍天，樹葉與邊緣細節自然保留
    if use_sky == 'grad':
        t = np.clip(1 - np.linspace(0, 1, H, dtype=np.float32)[:, None] / 0.46, 0, 1) ** 1.3
        bright = np.clip((out.mean(axis=2) - 0.50) / 0.34, 0, 1)
        k = (bright * t)[..., None] * 0.80
        out = out * (1 - k) + out * np.array([0.66, 0.78, 0.95], np.float32) * k
    elif use_sky:
        m, horizon = sky_mask(L0, chroma0)
        if m is not None:
            layer = sky_layer(H, W, horizon, seed)
            out = out * (1 - m[..., None]) + np.clip(out * 1.03, 0, 1) * layer * m[..., None]

    # 7. 分離色調：暗部帶深藍、亮部帶暖香檳，呼應網站的藍金配色（膚色減量）
    lab3 = cv2.cvtColor(out.astype(np.float32), cv2.COLOR_RGB2LAB)
    l3, a3, b3 = cv2.split(lab3)
    n = l3 / 100.0
    protect = 1 - 0.75 * skin
    shadow = (1 - n) ** 2.4
    light = n ** 2.2
    a3 = a3 + (1.2 * shadow + 0.9 * light) * protect
    b3 = b3 + (-8.5 * shadow + 4.0 * light) * protect
    # 8. 細節銳化（亮度通道）
    fine = cv2.GaussianBlur(l3, (0, 0), sigmaX=max(0.8, max(H, W) / 2400))
    l3 = np.clip(l3 + 0.50 * (1 - 0.8 * skin0) * (l3 - fine), 0, 100)
    out = np.clip(cv2.cvtColor(cv2.merge([l3, a3, b3]), cv2.COLOR_LAB2RGB), 0, 1)

    # 9. 暗角：把視線帶回主體
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    r2 = ((xx - W / 2) / (W / 2)) ** 2 * 0.9 + ((yy - H / 2) / (H / 2)) ** 2 * 1.1
    vig = 1 - 0.20 * np.clip(r2 / 2.0, 0, 1) ** 1.5
    out = out * vig[..., None]
    return (np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)


def crop_frac(im, cx, cy, w, aspect):
    """以比例指定裁切：中心 (cx, cy)、寬度 w（佔原圖寬度比例）、長寬比 aspect。"""
    W, H = im.size
    cw = w * W
    ch = cw / aspect
    if ch > H:
        ch = H
        cw = ch * aspect
    x0 = min(max(cx * W - cw / 2, 0), W - cw)
    y0 = min(max(cy * H - ch / 2, 0), H - ch)
    return im.crop((round(x0), round(y0), round(x0 + cw), round(y0 + ch)))
