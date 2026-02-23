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
