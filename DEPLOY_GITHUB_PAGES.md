# Публикация на GitHub Pages

Чтобы приложение «Энергомониторинг» открывалось по ссылке с GitHub, сделайте следующее.

---

## 1. Репозиторий на GitHub

1. Зайдите на [github.com](https://github.com) и войдите в аккаунт.
2. Нажмите **New repository** (или **+** → **New repository**).
3. Укажите имя репозитория (например, **Alena**).
4. Оставьте **Public**, не добавляйте README (если проект уже есть у вас на компьютере).
5. Нажмите **Create repository**.

---

## 2. Загрузить проект в репозиторий

Если папка проекта ещё **не** связана с Git:

```powershell
cd "C:\Users\Admin\Downloads\Alena"

git init
git add index.html app.js
git add ROADMAP.md README.md
git add supabase
git add *.md *.sql
git commit -m "Initial commit: Энергомониторинг"
git branch -M main
git remote add origin https://github.com/ВАШ_ЛОГИН/Alena.git
git push -u origin main
```

Замените **ВАШ_ЛОГИН** на ваш логин GitHub и **Alena** на имя репозитория, если оно другое.

Если репозиторий уже есть (уже делали `git init` и `remote`):

```powershell
cd "C:\Users\Admin\Downloads\Alena"
git add .
git commit -m "Update for GitHub Pages"
git push origin main
```

---

## 3. Включить GitHub Pages

1. В репозитории на GitHub откройте **Settings** (Настройки).
2. Слева выберите **Pages** (в разделе «Code and automation»).
3. В блоке **Build and deployment**:
   - **Source:** Deploy from a branch
   - **Branch:** выберите **main** (или **master**), папка **/ (root)**.
4. Нажмите **Save**.

Через 1–2 минуты сайт будет доступен по адресу:

- **https://ВАШ_ЛОГИН.github.io/Alena/**  
  (если репозиторий называется Alena)

Главная страница: **https://ВАШ_ЛОГИН.github.io/Alena/index.html**  
или **https://ВАШ_ЛОГИН.github.io/Alena/** (GitHub часто открывает index.html сам).

---

## 4. Что проверить

- Открывается ли страница по ссылке выше.
- Загружается ли приложение (логин, меню). Если нет — откройте консоль браузера (F12 → Console) и посмотрите ошибки.
- Работает ли авторизация Supabase (те же URL Supabase уже прописаны в `app.js`).

---

## 5. Дальнейшие обновления

После любых изменений в коде:

```powershell
cd "C:\Users\Admin\Downloads\Alena"
git add .
git commit -m "Описание изменений"
git push origin main
```

Сайт на GitHub Pages обновится в течение 1–2 минут.

---

## Важно

- **Supabase** (логин, данные) уже настроен в коде и работает с любого домена; отдельно настраивать ничего не нужно.
- Файл **.nojekyll** в корне репозитория уже добавлен — так GitHub не обрабатывает сайт через Jekyll, и все файлы отдаются как есть.
- Если репозиторий **приватный**, в бесплатном плане GitHub Pages может быть недоступен. Тогда либо сделайте репозиторий публичным, либо используйте платный аккаунт.

Если после этих шагов что-то не открывается или не работает — напишите, на каком шаге проблема и что видите в браузере (или в консоли F12).
