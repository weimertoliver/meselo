#!/bin/sh
# Imre hangmodelljének letöltése a sherpa-onnx kiadásából (Piper hu_HU-imre-medium)
set -e
cd "$(dirname "$0")/.."
mkdir -p vendor/imre
tmp=$(mktemp -d)
curl -sSL -o "$tmp/m.tar.bz2" https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-hu_HU-imre-medium.tar.bz2
tar -xjf "$tmp/m.tar.bz2" -C "$tmp" --exclude='*/espeak-ng-data/*'
cp "$tmp"/vits-piper-hu_HU-imre-medium/hu_HU-imre-medium.onnx "$tmp"/vits-piper-hu_HU-imre-medium/hu_HU-imre-medium.onnx.json "$tmp"/vits-piper-hu_HU-imre-medium/MODEL_CARD vendor/imre/
rm -rf "$tmp"
echo "kész: vendor/imre/hu_HU-imre-medium.onnx"
