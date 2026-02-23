# Деплой на GitHub (команды в терминале)

Выполняйте по порядку в терминале (PowerShell или CMD) из папки проекта.

## 1. Перейти в папку проекта

```powershell
cd c:\Users\Admin\Downloads\Alena
```

## 2. Добавить все изменённые и новые файлы

```powershell
git add -A
```

(Или только нужные: `git add app.js index.html supabase/`)

## 3. Сделать коммит

```powershell
git commit -m "SQL Editor steps, deploy docs, edge function fixes"
```

## 4. Отправить на GitHub

```powershell
git push origin main
```

---

## Всё одной командой (копируйте целиком)

```powershell
cd c:\Users\Admin\Downloads\Alena
git add -A
git status
git commit -m "SQL Editor steps, deploy docs, edge function fixes"
git push origin main
```

После `git status` проверьте список файлов. Если всё верно — выполните следующие две строки.

---

## Запустить деплой снова (если предыдущий прервали)

1. Откройте терминал (PowerShell).
2. Выполните по порядку:

```powershell
cd c:\Users\Admin\Downloads\Alena
git status
```

- Если видите **«nothing to commit, working tree clean»** — все изменения уже закоммичены. Тогда просто снова отправьте на GitHub:

```powershell
git push origin main
```

- Если видите **список изменённых файлов** — добавьте их, сделайте коммит и отправьте:

```powershell
git add -A
git commit -m "Deploy: SQL Editor steps, deploy docs, edge function fixes"
git push origin main
```

3. Дождитесь окончания `git push` (появится строка вида `xxxxx..yyyyy main -> main`). После этого репозиторий на GitHub обновится.
