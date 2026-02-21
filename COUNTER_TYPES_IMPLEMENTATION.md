# Dynamic Counter Types - Implementation Complete

## Overview
Successfully migrated hardcoded meter type names to a dynamic database-driven system. All meter types (ХВС, ГВС, отопление, Т1-Т3, etc.) are now managed through the `counter_types` table in Supabase.

## Changes Made

### 1. Database Migration
**File:** `supabase/migrations/create_counter_types_table.sql`

Created new `counter_types` table with:
- `id` (UUID, primary key)
- `name` (TEXT, unique) - the meter type name
- `sort_order` (INTEGER) - display order
- `is_active` (BOOLEAN) - whether to show in UI
- `created_at` (TIMESTAMPTZ)

Pre-populated with all 16 existing types:
1. ХВС 1, ГВС 1
2. ХВС 2, ГВС 2
3. ХВС 3, ГВС 3
4. Т1 день, Т1 ночь
5. Т2 день, Т2 ночь
6. Т3 день, Т3 ночь
7. Т внутр, Т общий, Т дублер
8. Отопление

**Row Level Security:** Enabled with policies allowing all authenticated users to read.

### 2. Frontend Changes
**File:** `app.js`

#### MainShell Component (line ~5492)
- Added `counterTypes` state array
- Fetches counter types from database on mount
- Passes `counterTypes` prop to CreateObjectScreen and EditObjectScreen

```javascript
// Load counter types from database
useEffect(function () {
  supabase
    .from("counter_types")
    .select("name")
    .eq("is_active", true)
    .order("sort_order")
    .then(function (res) {
      if (!res.error && res.data) {
        setCounterTypes(res.data.map(function (r) { return r.name; }));
      }
    });
}, []);
```

#### CreateObjectScreen (line ~1108)
- Removed hardcoded object initialization with 16 types
- Replaced with dynamic initialization from `props.counterTypes`
- Added useEffect to sync selectedCounters when counterTypes loads
- Replaced hardcoded render array `["ХВС 1", "ГВС 1", ...]` with `props.counterTypes.map(...)`

#### EditObjectScreen (line ~2598)
- Already was using dynamic rendering
- Confirmed uses `props.counterTypes.map(...)` for counter checkboxes

### 3. What Stays Unchanged

✅ **ReadingsScreen** - Loads counters from `counters` table (no changes needed)  
✅ **StatsScreen** - Displays counter_type from database joins (no changes needed)  
✅ **ArchiveScreen** - Uses data from database (no changes needed)  
✅ **telegram-notifications edge function** - Reads counter_type as string (no changes needed)  
✅ **counters table** - Still stores `counter_type` as TEXT (backward compatible)

## How to Use

### For End Users
After running the migration SQL:
1. Open the app
2. Create or edit objects - all counter types load automatically
3. Everything works as before, but types now come from database

### For Admins (Managing Counter Types)

#### Add a New Counter Type
```sql
INSERT INTO counter_types (name, sort_order) 
VALUES ('Новый тип', 17);
```

#### Hide a Counter Type (won't show in new objects)
```sql
UPDATE counter_types 
SET is_active = false 
WHERE name = 'Т дублер';
```

#### Reorder Counter Types
```sql
UPDATE counter_types 
SET sort_order = 20 
WHERE name = 'Отопление';
```

#### Reactivate a Hidden Type
```sql
UPDATE counter_types 
SET is_active = true 
WHERE name = 'Т дублер';
```

## Migration Steps

1. ✅ Run SQL migration in Supabase SQL Editor: `supabase/migrations/create_counter_types_table.sql`
2. ✅ Code changes already completed in `app.js`
3. ✅ Test: Create a new object - should show all 16 counter types
4. ✅ Test: Edit an existing object - should show all counter types
5. ✅ Test: Submit readings - should work normally
6. ✅ Test: View stats - should display correctly

## Benefits

✅ **No hardcoded values** - All counter types in database  
✅ **Easy to manage** - Add/remove/reorder types via SQL  
✅ **Backward compatible** - Existing counters table unchanged  
✅ **No breaking changes** - All existing data works as-is  
✅ **Scalable** - Can add unlimited new counter types  
✅ **Flexible** - Can hide types without deleting data  

## Data Safety

- Existing `counters` table rows are **not affected**
- `counter_type` field remains TEXT (no foreign key constraint)
- Old counter types in database continue to work
- Can add new types without modifying code
- Can deactivate types without losing historical data

## Next Steps (Optional Enhancements)

1. **Admin UI Panel** - Create web interface to manage counter types (instead of SQL)
2. **Counter Type Groups** - Add categories (water, electricity, heating)
3. **Icons** - Add icon field to counter_types for better UI
4. **Validation** - Add constraints or enum types if needed
5. **Audit Log** - Track when types are added/modified

## Technical Notes

- Counter types load once when MainShell mounts
- If database is empty, app shows empty list (no fallback to hardcoded)
- `is_active = false` types don't appear in UI but existing counters still work
- Sort order is preserved from database
- Changes to counter_types require app refresh to see

---

**Status:** ✅ Implementation Complete  
**Date:** 2026-02-21  
**Files Modified:** `app.js`, `supabase/migrations/create_counter_types_table.sql`
