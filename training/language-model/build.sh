#!/bin/sh
set -eu
if [ "$#" -ne 3 ]; then
  echo 'Usage: sh build.sh llama.cpp-source-dir llama.cpp-library-dir output-binary' >&2
  exit 2
fi
src=$(cd "$1" && pwd)
lib=$(cd "$2" && pwd)
script=$(cd "$(dirname "$0")" && pwd)
c++ -O2 -std=c++17 -I"$src/include" -I"$src/ggml/include" "$script/encode.cpp" \
  -L"$lib" -Wl,-rpath,"$lib" -lllama -lggml -o "$3"
