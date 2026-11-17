# orca-plugin — хаб плагинов Orca

Публичный репозиторий `Sergei-Popov/orca-plugin`: каталог Orca (`orca-catalog.json`) и все наши
плагины как git-submodules в `plugins/<name>`. Каждый плагин — **отдельный проект**: свой
публичный репозиторий `Sergei-Popov/orca-<name>`, своя история и свои релизы.

```
orca-plugin/                 хаб (этот репозиторий, проект Orca в группе "orca-plugin")
├── orca-catalog.json        каталог для Orca: Settings → Plugins → ⋯ → Catalog sources…
├── plugins/<name>/          submodule = отдельный репозиторий плагина = отдельный проект Orca
├── scripts/                 new-plugin.sh, release-plugin.sh, github-protect.sh, orca-group.sh,
│                            orca-window.sh, directory-check.sh, listing-image.sh (+ lib/listing)
├── templates/               LICENSE и CHANGELOG для новых плагинов
└── .claude/skills/          навыки для работы с плагинами (см. ниже)
```

## Обязательные правила

1. **Gitflow во всех проектах** (хаб и каждый плагин). `main` — только релизы с тегом,
   `develop` — интеграция, работа — в `feature/<topic>` от `develop`, релиз — `release/x.y.z`,
   срочный фикс — `hotfix/x.y.z` от `main`. Слияния `--no-ff`. Прямые коммиты в `main` запрещены,
   в `develop` — только слияния веток. Релиз вливается в `main` и обратно в `develop` двумя
   слияниями `--no-ff`, поэтому после релиза `develop` на коммит впереди `main` и позади на
   коммиты `Release …` — это норма. Не выравнивать ветки (fast-forward, слияние `main` в
   `develop`) и не открывать PR `develop` → `main`: подсказку GitHub «Compare & pull request»
   после пуша `develop` игнорировать, в `main` попадает только релиз или хотфикс.
   Подробно: навык `gitflow`.
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
   `scripts/release-plugin.sh`. Перед каждым релизом, который уйдёт в orca.dev, обязательно
   `scripts/directory-check.sh <name> --update` без ошибок (см. «Что задерживает плагин в orca.dev»).
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
scripts/orca-window.sh hide|show    # спрятать окно Orca (и из полноэкранного) для shot --act/--theme
scripts/directory-check.sh <name> [--update]   # перед релизом в orca.dev: валидатор каталога на ПК + самопроверка
scripts/listing-image.sh <name> --dry-run --check --sheet   # картинки листинга (обложка, скриншоты) в стиле хаба,
                                    # headless Chrome без окна Orca; стиль и схема — scripts/lib/listing/README.md

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
- Кастомные редакторы получают документ **не больше ~50 МиБ** (`MAX_PREVIEWABLE_BINARY_SIZE`;
  64 МиБ — только лимит моста), для больших файлов Orca показывает своё сообщение. Путь к файлу
  редактор не получает никогда. Файл скрипта/WASM/JSON во фрейме — до 16 МиБ, плагин — до 50 МиБ
  и 2 000 файлов.
- Orca сама проигрывает `.mp4/.m4v/.mov/.webm` и аудио `.mp3/.wav/.m4a/.aac/.ogg/.oga/.flac/.opus`
  во вкладке без лимита размера. Плагин с `priority: "default"` для этих типов отключил бы
  встроенный просмотр — используй `priority: "option"`, если не заменяешь его осознанно.
- Ссылка на файл в чате агента открывает файл во вкладке тем же путём, что и дерево файлов:
  редактор плагина с `priority: "default"` подхватит её сам.
- Id плагинов, начинающиеся с `orca-`, зарезервированы; publisher = владелец репозитория
  (`sergei-popov`), id в каталоге — `sergei-popov.<id>`.
- Сеть во фреймах закрыта, `eval` запрещён; библиотеки — копией ESM в плагин.
- Сама Orca открывает картинки (`.png .jpg .gif .svg .webp .bmp .ico`), PDF, CSV, Markdown и
  ноутбуки. Изолированный фрейм (`frame: "isolated"`) разрешает `blob:` для картинок и медиа и
  WebAssembly, но `font-src` — только `'self' data:`.
- Левый сайдбар (задачи, артефакты, автоматизации) плагинам закрыт: панели встают только в правый.
  `contributes.sidebarCards` зарезервирован под декларативные карточки, не под произвольный UI.

## Что задерживает плагин в orca.dev

Каталог проверяет релиз автоматически; сомнительное уходит «under review» к человеку (часами и
днями). Выведено 2026-11-15 из истории `status.json` stablyai/orca-community-plugins; всё это
ловит `scripts/directory-check.sh`:

- **Отказ:** бинарные файлы в дереве (кроме PNG/JPEG/GIF/WebP и WOFF/WOFF2), архивы, TTF/OTF,
  симлинки, сабмодули; даже один NUL-байт в `.ts`.
- **«code»:** base64-блобы, которые раскодируются в WASM/шрифты/архивы — **и в тестах тоже**
  (тестовые файлы строить кодом, байт за байтом); длинные цепочки `\xNN`/`\uNNNN`; `eval`.
  Из-за этого висит Font Viewer 0.1.0.
- **«content»:** файлы `.wasm` (Media Viewer 0.3.0).
- **«size»:** файл больше ~2 МиБ или плагин больше ~5 МиБ (скриншоты считаются).
- **«update»:** обновление добавляет расширения, возможности, команды, панели или меняет лицензию —
  всё это закладывать сразу в первую версию.
- **«name»:** название, начинающееся с чужого бренда («OpenAPI Preview», «Docker»); бренд — только
  в описании, с «Independent; not affiliated with …».
- **«pricing»:** цены, кредиты, «trial», «Pro».
- Повторный тег с тем же содержимым не помогает; если задержка дольше ~суток — выпустить патч,
  который убирает причину.

## Плагины

| Плагин         | Репозиторий                         | Что делает                                   |
| -------------- | ----------------------------------- | -------------------------------------------- |
| `media-viewer` | `Sergei-Popov/orca-media-viewer`    | Видео и аудио во вкладках Orca (Media Player) |
| `archive-viewer` | `Sergei-Popov/orca-archive-viewer` | Архивы `.zip`/`.jar`/`.tar.gz` во вкладке: дерево файлов, превью, сохранение файла |
| `font-viewer`  | `Sergei-Popov/orca-font-viewer`     | Шрифты `.ttf`/`.otf`/`.woff`/`.woff2` во вкладке: образец, символы, оси, сведения |
| `har-viewer`   | `Sergei-Popov/orca-har-viewer`      | Записи сети `.har`/`.har.zip`: список запросов и водопад, маскирование секретов, выгрузка для агента |
| `class-viewer` | `Sergei-Popov/orca-class-viewer`    | Файлы `.class` и архивы `.jar`/`.jmod`: объявления, байткод как javap, структура, пул констант |
| `image-viewer` | `Sergei-Popov/orca-image-viewer`    | Картинки, которые Orca не показывает: TIFF, HEIC, PSD, EXR, HDR, TGA, DDS, QOI, ICNS, превью RAW; страницы, слои, экспозиция, EXIF |
| `api-spec-viewer` | `Sergei-Popov/orca-api-spec-viewer` | OpenAPI 3.x, Swagger 2.0, AsyncAPI 2/3, Arazzo, Overlay: операции, схемы, примеры кода, поиск, проблемы |
| `project-workflows` | `Sergei-Popov/orca-project-workflows` | Проверяет изменения OpenSpec, показывает статус историй BMAD и передаёт задачи Codex или Claude Code в выбранном рабочем дереве. |
| `test-results` | `Sergei-Popov/orca-test-results` | Показывает причины сбоев из локальных отчётов JUnit XML, открывает исходник теста и готовит редактируемую сводку для агента. |
