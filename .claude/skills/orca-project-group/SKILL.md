---
name: orca-project-group
description: >-
  Put an Orca project (a plugin of this hub or the hub itself) into the Orca sidebar group
  "orca-plugin", creating the group if it is missing, and verify it. Orca's CLI cannot manage
  groups, so this drives Orca's UI with `orca computer`. Use after creating any new project here,
  when scripts/orca-group.sh status shows ✗, or when the user asks to group/attach projects.
---

# Orca project → group "orca-plugin"

Every project of this hub lives in the Orca sidebar group **orca-plugin** (the user's rule).
Orca 1.4.258 has no CLI or plugin API for groups: they exist only in the desktop UI (IPC
`projectGroups:*`), and the state store (`profile-state.db`) is overwritten from memory, so never
edit it. Read-only check:

```sh
scripts/orca-group.sh status          # ✓ in group / ✗ outside / ✗ not added to Orca
scripts/orca-group.sh id              # the group's id
```

## 0. Make sure the project is in Orca

```sh
orca repo add --path /abs/path/to/project --json      # git repo; --kind folder for a plain folder
```

## 1. Tell the user, then drive the UI

Popup menus only open with foreground input, which takes over the user's screen, pointer and
keyboard for a few seconds. Say so in one line before starting. Load the `orca-computer-use`
skill if its rules are not in context. App: `com.stablyai.orca`.

Coordinates: `orca computer` clicks take **window pixels**; the window screenshot from
`get-app-state` is in the same pixels (e.g. 2560 wide on a Retina screen). Downscale it to read it
(`sips -Z 1280 shot.png --out small.png`), then multiply what you read by the factor (×2).

1. **Sidebar visible?** The left sidebar can be hidden. Take
   `orca computer get-app-state --app com.stablyai.orca --json` and look at the screenshot. If the
   project list is not drawn, press the button "Показать или скрыть боковую панель" /
   "Toggle sidebar" (find its index with `--query "боковую панель"` or `--query sidebar`) and
   remember to press it again at the end. The project rows exist in the accessibility tree even
   when hidden, so trust the screenshot, not the tree.
2. **Find the row.** New projects are at the bottom of the list. Scroll the list:
   `orca computer scroll --app com.stablyai.orca --x 170 --y 770 --direction down --json` (repeat),
   then screenshot again. Rows read "<name> Действия с проектом <name> …" in the tree.
3. **Open the project menu.** Click the "⋯" button at the right end of the row (it appears on
   hover; about x≈294 on a 2560-wide window, same y as the row) **with `--restore-window`**.
   A background click fails with `background_unavailable`; AXShowMenu/right-click do nothing.
   The tree then shows `меню Действия с проектом <name>` with items: Настройки проекта,
   Изменить значок проекта, Показать скрытые рабочие деревья, **Новая группа из проекта**,
   **Переместить в группу**, Удалить проект (English UI: Project settings, …, New group from
   project, Move to group, Remove project).
4. **Menu items ignore AXPress** — click them by coordinates from a fresh screenshot,
   `--restore-window`.
   - Group exists → click **Переместить в группу**; a submenu lists the groups (FirstForma,
     Genmedia, **orca-plugin**, …) to its right; click **orca-plugin**.
   - Group missing → click **Новая группа из проекта**; dialog "Новая группа проектов" with field
     "Название группы" prefilled "Группа <name>". `set-value` does not replace it: the field has
     focus, so press `Delete`/`BackSpace` until empty (check the value in the returned tree), then
     `type-text --text "orca-plugin"` and click **Создать**.
5. **Verify** with `scripts/orca-group.sh status`. Hide the sidebar again if you showed it.

If the UI does not cooperate after one careful retry, stop and ask the user to do it by hand:
"⋯ next to <name> in the Projects sidebar → Move to group → orca-plugin" (or drag the project onto
the group). Never report the move as done until `orca-group.sh status` shows ✓.

## Don'ts

- Don't remove or rename the group, or move other projects, unless asked.
- `orca plugin open … --editor <file>` on a file outside every project makes Orca add the file's
  folder as a new project. Remove such strays the same way: project "⋯" → Удалить проект /
  Remove project → confirm (it only forgets the folder; nothing on disk is deleted).
