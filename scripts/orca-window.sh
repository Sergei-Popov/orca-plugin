#!/usr/bin/env bash
# Hides Orca's main window for `orca plugin shot --act/--theme` and puts it back afterwards (macOS).
#
#   scripts/orca-window.sh hide     # leave full screen if needed, then minimize
#   scripts/orca-window.sh show     # un-minimize and return to full screen if `hide` left it
#   scripts/orca-window.sh status   # prints: minimized=<bool> fullscreen=<bool>
#
# `shot --act/--theme` needs the window hidden or minimized. A full-screen window counts as on
# screen, and `set visible of process "Orca" to false` does nothing to it, so `hide` leaves full
# screen first. It remembers that in $TMPDIR/orca-window-state for `show`. The chat with the user
# usually runs inside Orca, so keep the window hidden only for a prepared batch of shots.
. "$(dirname "$0")/lib/common.sh"
[[ "$(uname -s)" == Darwin ]] || die "only macOS is supported"
require osascript

state_file="${TMPDIR:-/tmp}/orca-window-state"

# Runs one action on Orca's main window (its first standard window: Orca can also have small
# untitled helper windows). Prints "minimized=<bool> fullscreen=<bool>" afterwards.
window() {
  osascript - "$1" <<'APPLESCRIPT'
on run argv
  -- Not `action`: inside a System Events tell block that word names a class, so `if action is …`
  -- would never match and the window would silently stay as it was.
  set todo to item 1 of argv
  tell application "System Events"
    if not (exists process "Orca") then error "Orca is not running"
    tell process "Orca"
      set idx to 0
      repeat with i from 1 to (count of windows)
        try
          if value of attribute "AXSubrole" of window i is "AXStandardWindow" then
            set idx to i
            exit repeat
          end if
        end try
      end repeat
      if idx is 0 then error "Orca has no main window"
      if todo is "leave-fullscreen" then
        set value of attribute "AXFullScreen" of window idx to false
      else if todo is "enter-fullscreen" then
        set value of attribute "AXFullScreen" of window idx to true
      else if todo is "minimize" then
        set value of attribute "AXMinimized" of window idx to true
      else if todo is "unminimize" then
        set value of attribute "AXMinimized" of window idx to false
      end if
      return "minimized=" & (value of attribute "AXMinimized" of window idx) & " fullscreen=" & (value of attribute "AXFullScreen" of window idx)
    end tell
  end tell
end run
APPLESCRIPT
}

# Runs an action, then polls until the window reports the wanted state. macOS animates full screen,
# and while it moves the window to or from its own Space the window can briefly vanish from the
# accessibility tree, so a failed call is retried (the actions are idempotent).
until_state() {
  local action="$1" want="$2" now="" i
  for i in {1..20}; do
    if now="$(window "$action" 2>&1)"; then
      [[ "$now" == *"$want"* ]] && { printf '%s\n' "$now"; return 0; }
      action=status
    fi
    sleep 0.5
  done
  die "Orca's window did not reach $want (last: $now)"
}

case "${1:-}" in
  status)
    window status
    ;;
  hide)
    now="$(window status)"
    if [[ "$now" == *"minimized=true"* ]]; then
      log "already minimized"
      printf '%s\n' "$now"
      exit 0
    fi
    fullscreen=false
    if [[ "$now" == *"fullscreen=true"* ]]; then
      fullscreen=true
      log "leaving full screen"
      until_state leave-fullscreen "fullscreen=false" >/dev/null
      sleep 0.5
    fi
    printf 'fullscreen=%s\n' "$fullscreen" > "$state_file"
    until_state minimize "minimized=true"
    ;;
  show)
    until_state unminimize "minimized=false" >/dev/null
    if [[ -f "$state_file" ]] && grep -q '^fullscreen=true$' "$state_file"; then
      sleep 0.5
      log "returning to full screen"
      until_state enter-fullscreen "fullscreen=true" >/dev/null
    fi
    rm -f "$state_file"
    window status
    ;;
  *)
    sed -n '2,11p' "$0"
    exit 2
    ;;
esac
