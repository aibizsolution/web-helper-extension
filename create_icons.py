#!/usr/bin/env python3
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
ICONS_DIR = ROOT / "icons"
ICON_SIZES = (16, 48, 128)
MASTER_SIZE = 512


def lerp(a, b, t):
    return int(round(a + (b - a) * t))


def lerp_color(start, end, t):
    return tuple(lerp(s, e, t) for s, e in zip(start, end))


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def add_soft_glow(image, bbox, color, blur_radius):
    glow = Image.new("RGBA", image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(glow)
    draw.ellipse(bbox, fill=color)
    glow = glow.filter(ImageFilter.GaussianBlur(blur_radius))
    image.alpha_composite(glow)


def create_tile(size):
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))

    shadow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_inset = int(size * 0.11)
    shadow_radius = int(size * 0.19)
    shadow_draw.rounded_rectangle(
        (
            shadow_inset,
            shadow_inset + int(size * 0.03),
            size - shadow_inset,
            size - shadow_inset + int(size * 0.03),
        ),
        radius=shadow_radius,
        fill=(2, 6, 16, 110),
    )
    shadow = shadow.filter(ImageFilter.GaussianBlur(int(size * 0.045)))
    tile.alpha_composite(shadow)

    inset = int(size * 0.09)
    radius = int(size * 0.18)
    rect = (inset, inset, size - inset, size - inset)
    rect_width = rect[2] - rect[0]
    rect_height = rect[3] - rect[1]

    surface = Image.new("RGBA", (rect_width, rect_height), (0, 0, 0, 0))
    pixels = surface.load()
    top = (17, 30, 63)
    bottom = (8, 16, 34)
    side_glow = (24, 89, 206)
    for y in range(rect_height):
        for x in range(rect_width):
            vertical_t = y / max(1, rect_height - 1)
            horizontal_t = x / max(1, rect_width - 1)
            base = lerp_color(top, bottom, vertical_t)
            blue_mix = max(0.0, 1.0 - abs(horizontal_t - 0.78) * 2.2)
            pixels[x, y] = (
                min(255, base[0] + int(side_glow[0] * blue_mix * 0.12)),
                min(255, base[1] + int(side_glow[1] * blue_mix * 0.18)),
                min(255, base[2] + int(side_glow[2] * blue_mix * 0.2)),
                255,
            )

    mask = rounded_mask(rect_width, radius)
    surface.putalpha(mask)
    tile.alpha_composite(surface, rect[:2])

    add_soft_glow(
        tile,
        (
            int(size * 0.56),
            int(size * 0.57),
            int(size * 0.97),
            int(size * 0.98),
        ),
        (38, 120, 255, 84),
        int(size * 0.08),
    )
    add_soft_glow(
        tile,
        (
            int(size * 0.18),
            int(size * 0.1),
            int(size * 0.72),
            int(size * 0.56),
        ),
        (120, 166, 255, 34),
        int(size * 0.11),
    )

    border = Image.new("RGBA", (rect_width, rect_height), (0, 0, 0, 0))
    border_draw = ImageDraw.Draw(border)
    border_draw.rounded_rectangle(
        (1, 1, rect_width - 2, rect_height - 2),
        radius=radius,
        outline=(113, 166, 255, 78),
        width=max(2, size // 40),
    )
    border.putalpha(mask)
    tile.alpha_composite(border, rect[:2])

    sheen = Image.new("RGBA", (rect_width, rect_height), (0, 0, 0, 0))
    sheen_draw = ImageDraw.Draw(sheen)
    sheen_draw.polygon(
        [
            (int(rect_width * 0.06), int(rect_height * 0.12)),
            (int(rect_width * 0.62), int(rect_height * 0.03)),
            (int(rect_width * 0.4), int(rect_height * 0.45)),
            (int(rect_width * 0.0), int(rect_height * 0.4)),
        ],
        fill=(255, 255, 255, 20),
    )
    sheen = sheen.filter(ImageFilter.GaussianBlur(int(size * 0.03)))
    sheen.putalpha(ImageChops.multiply(sheen.getchannel("A"), mask))
    tile.alpha_composite(sheen, rect[:2])

    return tile


def draw_globe_mark(image):
    size = image.size[0]
    draw = ImageDraw.Draw(image)

    cx = size * 0.5
    cy = size * 0.54
    radius = size * 0.17
    ring_width = max(8, int(size * 0.024))
    line_width = max(6, int(size * 0.016))

    add_soft_glow(
        image,
        (
            int(cx - radius * 1.4),
            int(cy - radius * 1.35),
            int(cx + radius * 1.4),
            int(cy + radius * 1.4),
        ),
        (50, 170, 255, 48),
        int(size * 0.05),
    )

    ring_box = (cx - radius, cy - radius, cx + radius, cy + radius)
    draw.ellipse(ring_box, outline=(247, 250, 255, 240), width=ring_width)

    draw.ellipse(
        (cx - radius * 0.98, cy - radius * 0.3, cx + radius * 0.98, cy + radius * 0.3),
        outline=(129, 219, 255, 200),
        width=line_width,
    )
    draw.ellipse(
        (cx - radius * 0.98, cy - radius * 0.64, cx + radius * 0.98, cy + radius * 0.64),
        outline=(129, 219, 255, 116),
        width=max(4, line_width - 1),
    )
    draw.arc(
        (cx - radius * 0.5, cy - radius * 0.96, cx + radius * 0.5, cy + radius * 0.96),
        64,
        296,
        fill=(129, 219, 255, 164),
        width=max(4, line_width - 1),
    )
    draw.arc(
        (cx - radius * 0.22, cy - radius * 0.92, cx + radius * 0.22, cy + radius * 0.92),
        70,
        290,
        fill=(129, 219, 255, 116),
        width=max(3, line_width - 2),
    )

    orbit_draw = ImageDraw.Draw(image)
    orbit_draw.arc(
        (cx - radius * 1.18, cy - radius * 1.05, cx + radius * 1.22, cy + radius * 1.02),
        208,
        352,
        fill=(103, 169, 255, 116),
        width=max(4, int(size * 0.012)),
    )

    star_cx = cx + radius * 0.82
    star_cy = cy - radius * 0.78
    star = radius * 0.36
    star_points = [
        (star_cx, star_cy - star),
        (star_cx + star * 0.38, star_cy - star * 0.38),
        (star_cx + star, star_cy),
        (star_cx + star * 0.38, star_cy + star * 0.38),
        (star_cx, star_cy + star),
        (star_cx - star * 0.38, star_cy + star * 0.38),
        (star_cx - star, star_cy),
        (star_cx - star * 0.38, star_cy - star * 0.38),
    ]
    draw.polygon(star_points, fill=(86, 212, 255, 255))
    draw.ellipse(
        (
            star_cx - star * 0.22,
            star_cy - star * 0.22,
            star_cx + star * 0.22,
            star_cy + star * 0.22,
        ),
        fill=(247, 250, 255, 255),
    )

    draw.rounded_rectangle(
        (
            cx - radius * 0.95,
            cy + radius * 1.14,
            cx + radius * 0.34,
            cy + radius * 1.4,
        ),
        radius=int(size * 0.032),
        fill=(59, 128, 255, 235),
    )


def render_icon(size):
    master = create_tile(MASTER_SIZE)
    draw_globe_mark(master)
    icon = master.resize((size, size), Image.Resampling.LANCZOS)
    icon = icon.filter(
        ImageFilter.UnsharpMask(
            radius=max(0.5, size / 32),
            percent=135,
            threshold=2,
        )
    )
    return icon


def build_preview(icon_map):
    preview = Image.new("RGBA", (780, 260), (244, 247, 252, 255))
    draw = ImageDraw.Draw(preview)
    draw.rounded_rectangle((20, 20, 760, 240), radius=28, fill=(255, 255, 255, 255), outline=(217, 224, 236, 255))
    dark_chip = Image.new("RGBA", (220, 220), (0, 0, 0, 0))
    chip_draw = ImageDraw.Draw(dark_chip)
    chip_draw.rounded_rectangle((0, 0, 219, 219), radius=42, fill=(11, 15, 24, 255))
    preview.alpha_composite(dark_chip, (62, 20))

    placements = {
        128: (108, 66),
        48: (370, 106),
        16: (474, 122),
    }

    for size, icon in icon_map.items():
        preview.alpha_composite(icon, placements[size])

    return preview


def main():
    ICONS_DIR.mkdir(parents=True, exist_ok=True)
    generated = {}

    for size in ICON_SIZES:
        icon = render_icon(size)
        output = ICONS_DIR / f"icon{size}.png"
        icon.save(output)
        generated[size] = icon
        print(f"Created {output}")

    preview = build_preview(generated)
    preview_path = ICONS_DIR / "icon-preview.png"
    preview.save(preview_path)
    print(f"Created {preview_path}")


if __name__ == "__main__":
    main()
