# orca-plugin — хаб плагинов Orca

Публичный репозиторий `Sergei-Popov/orca-plugin`: каталог Orca (`orca-catalog.json`) и все наши
плагины как git-submodules в `plugins/<name>`. Каждый плагин — **отдельный проект**: свой
публичный репозиторий `Sergei-Popov/orca-<name>`, своя история и свои релизы.

```
orca-plugin/                 хаб (этот репозиторий, проект Orca в группе "orca-plugin")
├── orca-catalog.json        каталог для Orca: Settings → Plugins → ⋯ → Catalog sources…
├── plugins/<name>/          submodule = отдельный репозиторий плагина = отдельный проект Orca
├── scripts/                 new-plugin.sh, release-plugin.sh, github-protect.sh, orca-group.sh
├── templates/               LICENSE и CHANGELOG для новых плагинов
└── .claude/skills/          навыки для работы с плагинами (см. ниже)
```

## Обязательные правила

1. **Gitflow во всех проектах** (хаб и каждый плагин). `main` — только релизы с тегом,
   `develop` — интеграция, работа — в `feature/<topic>` от `develop`, релиз — `release/x.y.z`,
   срочный фикс — `hotfix/x.y.z` от `main`. Слияния `--no-ff`. Прямые коммиты в `main` запрещены,
   в `develop` — только слияния веток. Подробно: навык `gitflow`.
2. **Новый проект → группа Orca `orca-plugin`.** Когда создаёшь плагин (или любой другой проект
   этого хаба), добавь его в Orca и перенеси в группу `orca-plugin`: `scripts/new-plugin.sh`
   делает всё, кроме переноса; перенос — навык `orca-project-group`; проверка —
   `scripts/orca-group.sh status` (должны быть ✓ у всех).
3. **Контрибьютят только владельцы.** Репозитории публичные, но PR открывают только коллабораторы
   (`pull_request_creation_policy=collaborators_only`), `main`/`develop` защищены от удаления и
   force-push (ruleset `gitflow`). Новые репозитории — только через `scripts/new-plugin.sh`
   (он вызывает `scripts/github-protect.sh`). Коллабораторов не добавлять без явной просьбы.
4. **Публикация в каталог orca.dev** (топик `orca-plugin` у репозитория плагина) — только по явной
   просьбе пользователя. Наш собственный каталог (`orca-catalog.json`) обновляется
   `scripts/release-plugin.sh`.
5. **Одобрение плагина** (`--approve <fingerprint>`) — только для плагина и доступа, о которых
   просил пользователь. Перед одобрением покажи, что он получит (`orca plugin inspect`).

## Навыки (`.claude/skills/`)

| Навык                    | Когда                                                                 |
| ------------------------ | --------------------------------------------------------------------- |
| `orca-plugin-authoring`  | Любая работа с кодом плагина: манифест, редакторы, панели, воркеры, API |
| `orca-plugin-new`        | «Сделай новый плагин …» — создание подпроекта целиком                  |
| `orca-plugin-release`    | Выпуск версии плагина и обновление каталога                           |
| `orca-project-group`     | Добавить проект Orca в группу `orca-plugin` (через UI Orca)           |
| `gitflow`                | Ветки, слияния, релизы и хотфиксы                                     |

Глобальные навыки `orca-cli` и `orca-computer-use` тоже нужны: CLI Orca и управление её окном.

## Команды

```sh
scripts/new-plugin.sh <name> --template editor --title "Name" --description "…"
scripts/release-plugin.sh <name> <x.y.z>
scripts/orca-group.sh status
scripts/github-protect.sh Sergei-Popov/<repo>

# внутри plugins/<name>
orca plugin dev watch . --check      # загрузить в Orca, перезагрузка при сохранении, логи
orca plugin test .                    # тесты src/*.test.ts
npx -y -p typescript@5.9.3 tsc -p .   # проверка типов (после `orca plugin types .`)
orca plugin check . && orca plugin validate .
orca plugin shot local.<id> --editor <file>   # PNG редактора — смотри результат глазами
```

Все команды `orca plugin …` — с `--json`, ветвиться по `error.code`.

## Что важно знать про Orca (1.4.258)

- Группы проектов в сайдбаре **не управляются из CLI** — только UI (или навык `orca-project-group`).
  Данные лежат в `~/Library/Application Support/orca/profiles/<profile>/profile-state.db`
  (домен `projectGroups`, у репозитория — `projectGroupId`); база только для чтения, Orca
  перезаписывает её из памяти.
- Кастомные редакторы получают документ **не больше 64 МиБ**, для больших файлов Orca показывает
  своё сообщение. Путь к файлу редактор не получает никогда.
- Orca сама проигрывает `.mp4/.m4v/.mov/.webm` и аудио `.mp3/.wav/.m4a/.aac/.ogg/.oga/.flac/.opus`
  во вкладке без лимита размера. Плагин с `priority: "default"` для этих типов отключил бы
  встроенный просмотр — используй `priority: "option"`, если не заменяешь его осознанно.
- Ссылка на файл в чате агента открывает файл во вкладке тем же путём, что и дерево файлов:
  редактор плагина с `priority: "default"` подхватит её сам.
- Id плагинов, начинающиеся с `orca-`, зарезервированы; publisher = владелец репозитория
  (`sergei-popov`), id в каталоге — `sergei-popov.<id>`.
- Сеть во фреймах закрыта, `eval` запрещён; библиотеки — копией ESM в плагин.

## Плагины

| Плагин         | Репозиторий                         | Что делает                                   |
| -------------- | ----------------------------------- | -------------------------------------------- |
| `media-viewer` | `Sergei-Popov/orca-media-viewer`    | Видео и аудио во вкладках Orca (Media Player) |
