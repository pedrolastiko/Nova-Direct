#!/bin/sh
# Génère thumbs/<station>.png à partir de logos/<station>.png.
#
# Le cadrage reproduit exactement celui de la grande pochette (voir la règle
# `.art img.is-logo` dans styles.css) : carré aligné en haut, et non centré.
# Les logos sont en portrait avec leur composition dans la moitié haute ; un
# recadrage centré rognerait le lettrage et garderait le vide du bas.
#
# N'utilise que sips, fourni par macOS. Déterministe : relancé sur les mêmes
# logos, il produit des fichiers identiques.
#
#   sh tools/make-thumbs.sh

set -eu

cd "$(dirname "$0")/.."

SIZE=128

if [ ! -d logos ]; then
  echo "logos/ introuvable — lancez ce script depuis la racine du projet." >&2
  exit 1
fi

mkdir -p thumbs

for src in logos/*.png; do
  id=$(basename "$src" .png)
  out="thumbs/$id.png"

  # Côté du carré = largeur du logo, pour ne rogner que verticalement.
  width=$(sips -g pixelWidth "$src" | awk '/pixelWidth/ { print $2 }')

  cp "$src" "$out"
  sips -c "$width" "$width" --cropOffset 0 0 "$out" >/dev/null
  sips -z "$SIZE" "$SIZE" "$out" >/dev/null

  printf '%-22s %6s octets\n' "$out" "$(wc -c <"$out" | tr -d ' ')"
done
