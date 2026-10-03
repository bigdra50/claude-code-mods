#!/usr/bin/env bash
# Shows mission-control's code map in a WezTerm pane, redrawn when it changes.
# WezTerm draws kitty images but not the Unicode placeholders Claude Code places them with,
# so the mod opens this in a pane to the right instead of drawing an Image in Claude Code.
# Usage: mission-map.sh [map dir] [seconds between checks]
set -euo pipefail

if [[ $# -ge 1 ]]; then
    dir="$1"
else
    dir="${TMPDIR:-/tmp}"
    dir="${dir%/}/mission-control"
fi
interval="${2:-2}"

# A pane opened by a key binding has no Homebrew PATH: fall back to the wezterm next to the GUI.
wezterm_bin="$(command -v wezterm || true)"
if [[ -z "$wezterm_bin" && -x "${WEZTERM_EXECUTABLE_DIR:-}/wezterm" ]]; then
    wezterm_bin="$WEZTERM_EXECUTABLE_DIR/wezterm"
fi
if [[ -z "$wezterm_bin" ]]; then
    echo "wezterm not found (not on PATH, not in WEZTERM_EXECUTABLE_DIR)" >&2
    exit 1
fi

# map-0.png and map-1.png are written in turn: the newer one is the latest.
# Before the first map, print nothing and succeed (set -e must not end the loop).
latest() {
    ls -t "$dir"/map-*.png 2>/dev/null | head -n 1 || true
}

# Modified time and size tell a new map (macOS stat).
signature() {
    stat -f '%m %z' "$1" 2>/dev/null || true
}

# imgcat does not treat --height as a limit when --width is given too, so a wide pane overflows.
# Compare the image's shape with the pane's and pass only one of them.
# A cell is taken as twice as tall as it is wide (about right for monospace fonts).
fit_args() {
    local w h cols rows
    w="$(sips -g pixelWidth "$1" 2>/dev/null | awk '/pixelWidth/ {print $2}')"
    h="$(sips -g pixelHeight "$1" 2>/dev/null | awk '/pixelHeight/ {print $2}')"
    cols="$(tput cols)"
    # Keep the last row for the cursor.
    rows="$(($(tput lines) - 1))"
    if [[ -z "$w" || -z "$h" ]] || ((cols * h <= rows * 2 * w)); then
        echo "--width $cols"
    else
        echo "--height $rows"
    fi
}

shown=""
resized=1
trap 'resized=1' WINCH
trap 'printf "\n"; exit 0' INT TERM

while :; do
    file="$(latest)"
    if [[ -z "$file" ]]; then
        if [[ "$shown" != "none" ]]; then
            clear
            printf 'Waiting for the code map in %s\nIt draws once the Code view (c) of /mission is open.\n' "$dir"
            shown="none"
        fi
    else
        sig="$file $(signature "$file")"
        if [[ "$sig" != "$shown" || "$resized" == 1 ]]; then
            # Skip a PNG still being written: wait a moment and check the size held.
            sleep 0.3
            if [[ "$sig" == "$file $(signature "$file")" ]]; then
                clear
                read -ra fit <<<"$(fit_args "$file")"
                "$wezterm_bin" imgcat "${fit[@]}" "$file" || true
                shown="$sig"
                resized=0
            fi
        fi
    fi
    # Wait on sleep so a WINCH (pane resized) redraws at once.
    sleep "$interval" &
    wait $! || true
done
