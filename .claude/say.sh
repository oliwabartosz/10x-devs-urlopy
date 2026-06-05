#!/bin/sh
LOCKFILE="/tmp/piper_speech.lock"
(
  flock -x 9
  echo "$1" | /home/dzik/piper/piper --model /home/dzik/piper/pl_PL-darkman-medium.onnx --output_raw 2>/dev/null | aplay -r 22050 -f S16_LE -t raw 2>/dev/null
) 9>"$LOCKFILE"
