#!/usr/bin/env python3
"""Génère les icônes de la PWA à partir de l'icône officielle de Radio Nova.

Source : tools/nova-icon-source.png, récupérée depuis l'`apple-touch-icon`
déclaré par nova.fr — un carré noir arrondi portant un « n » blanc.

Deux traitements sont nécessaires, et aucun n'est faisable avec `sips` :

  - **Aplatissement sur noir.** La source a un canal alpha : ses coins arrondis
    sont transparents. Laissés tels quels, ils feraient des trous dans l'icône
    « maskable », qu'Android recadre lui-même. Pour l'icône iOS, on veut de
    toute façon un carré plein bord à bord : iOS applique son propre arrondi,
    et un arrondi déjà présent laisserait des angles morts visibles.

  - **Zone de sécurité de l'icône « maskable ».** Android peut recadrer
    jusqu'à un cercle inscrit ; le contenu doit tenir dans les 80 % centraux.
    Le « n » est donc réduit et recentré sur un fond noir.

D'où ce décodeur PNG minimal. La source est en RVBA 8 bits non entrelacée, le
seul cas géré — le script échoue explicitement sur tout autre format plutôt que
de produire une image fausse.

Déterministe et sans dépendance externe :

    python3 tools/make-icons.py
"""

import os
import struct
import zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, "tools", "nova-icon-source.png")
OUT_DIR = os.path.join(ROOT, "icons")

BACKGROUND = (0, 0, 0)  # le noir de l'icône officielle
MASKABLE_CONTENT = 0.66  # part de la largeur occupée par le contenu


# --------------------------------------------------------------------- PNG I/O

def read_png_rgba(path):
    """Retourne (largeur, hauteur, pixels RVBA) pour un PNG 8 bits non entrelacé."""
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} n'est pas un PNG")

    idat = bytearray()
    width = height = None
    pos = 8
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos:pos + 4])
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + length]
        if tag == b"IHDR":
            width, height, depth, color, comp, filt, interlace = struct.unpack(">IIBBBBB", body)
            if (depth, color, interlace) != (8, 6, 0):
                raise ValueError(
                    f"format non géré (profondeur={depth}, type={color}, entrelacé={interlace}) ; "
                    "attendu RVBA 8 bits non entrelacé"
                )
        elif tag == b"IDAT":
            idat += body
        elif tag == b"IEND":
            break
        pos += 12 + length

    raw = zlib.decompress(bytes(idat))
    stride = width * 4
    out = bytearray(stride * height)
    prev = bytearray(stride)
    pos = 0
    for y in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos:pos + stride])
        pos += stride
        # Défiltrage : chaque type prédit l'octet à partir de ses voisins.
        if ftype == 1:      # Sub — voisin de gauche
            for i in range(4, stride):
                line[i] = (line[i] + line[i - 4]) & 0xFF
        elif ftype == 2:    # Up — voisin du dessus
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:    # Average
            for i in range(stride):
                left = line[i - 4] if i >= 4 else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:    # Paeth
            for i in range(stride):
                a = line[i - 4] if i >= 4 else 0
                b = prev[i]
                c = prev[i - 4] if i >= 4 else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pred) & 0xFF
        elif ftype != 0:
            raise ValueError(f"type de filtre inconnu : {ftype}")
        out[y * stride:(y + 1) * stride] = line
        prev = line

    return width, height, out


def write_png_rgb(path, width, height, rows):
    raw = b"".join(b"\x00" + row for row in rows)

    def chunk(tag, payload):
        body = tag + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as fh:
        fh.write(png)


# ------------------------------------------------------------------ traitement

def flatten(width, height, rgba):
    """Composite la source sur le fond opaque ; retourne une liste de lignes RVB."""
    br, bg, bb = BACKGROUND
    rows = []
    for y in range(height):
        base = y * width * 4
        row = bytearray()
        for x in range(width):
            i = base + x * 4
            a = rgba[i + 3]
            if a == 255:
                row += bytes((rgba[i], rgba[i + 1], rgba[i + 2]))
            elif a == 0:
                row += bytes((br, bg, bb))
            else:
                row += bytes((
                    (rgba[i] * a + br * (255 - a)) // 255,
                    (rgba[i + 1] * a + bg * (255 - a)) // 255,
                    (rgba[i + 2] * a + bb * (255 - a)) // 255,
                ))
        rows.append(bytes(row))
    return rows


def resample(rows, src_size, dst_size):
    """Réduction par moyenne d'aire — sans crénelage sur les bords du « n »."""
    if src_size == dst_size:
        return rows
    scale = src_size / dst_size
    out = []
    for y in range(dst_size):
        y0, y1 = int(y * scale), max(int(y * scale) + 1, int((y + 1) * scale))
        row = bytearray()
        for x in range(dst_size):
            x0, x1 = int(x * scale), max(int(x * scale) + 1, int((x + 1) * scale))
            r = g = b = n = 0
            for sy in range(y0, min(y1, src_size)):
                line = rows[sy]
                for sx in range(x0, min(x1, src_size)):
                    r += line[sx * 3]
                    g += line[sx * 3 + 1]
                    b += line[sx * 3 + 2]
                    n += 1
            row += bytes((r // n, g // n, b // n))
        out.append(bytes(row))
    return out


def pad(rows, content_size, canvas_size):
    """Centre un contenu déjà réduit sur un fond opaque de canvas_size."""
    br, bg, bb = BACKGROUND
    blank = bytes((br, bg, bb)) * canvas_size
    offset = (canvas_size - content_size) // 2
    out = []
    for y in range(canvas_size):
        if y < offset or y >= offset + content_size:
            out.append(blank)
            continue
        line = rows[y - offset]
        out.append(bytes((br, bg, bb)) * offset + line + bytes((br, bg, bb)) * (canvas_size - content_size - offset))
    return out


def main():
    width, height, rgba = read_png_rgba(SOURCE)
    if width != height:
        raise ValueError(f"source non carrée : {width}x{height}")
    flat = flatten(width, height, rgba)

    os.makedirs(OUT_DIR, exist_ok=True)

    # Icônes pleines : iOS et Android appliquent eux-mêmes l'arrondi.
    for name, size in [("icon-512.png", 512), ("icon-192.png", 192), ("icon-180.png", 180)]:
        write_png_rgb(os.path.join(OUT_DIR, name), size, size, resample(flat, width, size))
        print(f"icons/{name}")

    # Icône « maskable » : contenu réduit dans la zone de sécurité.
    content = int(512 * MASKABLE_CONTENT)
    shrunk = resample(flat, width, content)
    write_png_rgb(os.path.join(OUT_DIR, "maskable-512.png"), 512, 512, pad(shrunk, content, 512))
    print("icons/maskable-512.png")


if __name__ == "__main__":
    main()
