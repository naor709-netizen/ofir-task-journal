# יומן המשימות של אופיר

פלטפורמת יומן משימות אישית, עצמאית לחלוטין — Next.js + Supabase, עברית/RTL, מותאמת לאייפון.
עיצוב כהה, סנכרון בין מכשירים בזמן אמת, ואפס תלות בפרויקטים אחרים.

## יכולות

- **5 תצוגות**: דשבורד (לוח שנה + רשימה + מדדים), אג'נדה שבועית, טבלה ממיינת, קנבן עם גרירה, אנליטיקות
- **משימות**: קטגוריות צבע חופשיות, מהות (אישי/דחוף/שוטף), קריטיות, תאריך יעד (מוצג בלוח), תאריך סיום
- **תזכורות** לפי תאריך ושעה (התראת דפדפן + התראה באפליקציה)
- **קבצים מצורפים** לכל משימה
- **תתי-משימות (שלבים)** רקורסיביים — לכל שלב כל המאפיינים של משימה
- **סטטוסים**: לביצוע → בתהליך → הושלם
- **סינון מורכב** מסרגל צד: קטגוריות, מהות, סטטוס, קריטיות, חיפוש חופשי
- **סנכרון ענן** דרך Supabase, עם נפילה חלקה ל-localStorage אם אין חיבור

## הגדרה (פעם אחת)

### 1. Supabase
1. היכנס לפרויקט ה-Supabase הייעודי (הנפרד) → **SQL Editor**
2. הרץ את התוכן של [`supabase-schema.sql`](./supabase-schema.sql)
   (יוצר את הטבלאות `journal_tasks` + `journal_meta` ומפעיל realtime)
3. העתק מ-**Project Settings → API** את:
   - `Project URL`
   - מפתח `anon public`

### 2. משתני סביבה
העתק את [`.env.example`](./.env.example) ל-`.env.local` ומלא את שני הערכים:

```
NEXT_PUBLIC_SUPABASE_URL=https://XXXXXXXX.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
```

### 3. פיתוח מקומי

```bash
npm install
npm run dev
```

פתח http://localhost:3000

## פריסה ל-Vercel

1. **New Project** → ייבוא הריפו הזה
2. הוסף את שני משתני הסביבה שלמעלה (Environment Variables)
3. **Deploy** — מקבלים כתובת ייעודית משלו

בלי משתני הסביבה האפליקציה עדיין עובדת, אך שומרת מקומית בלבד (חיווי "מקומי בלבד").

## התראות Web Push (תזכורות כשהיומן סגור)

תזכורות מגיעות כהתראת מערכת גם כשהיומן סגור, דרך Web Push:

1. **מפתחות VAPID** — צור עם `npx web-push generate-vapid-keys` והוסף ל-Vercel:
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (mailto), ו-`CRON_SECRET` (מחרוזת אקראית).
2. **Supabase** — הפעל את התוספים `pg_cron` ו-`pg_net` (Database → Extensions), ואז הרץ את
   [`supabase-reminders.sql`](./supabase-reminders.sql) (יוצר טבלאות + משימת cron שכל דקה קוראת ל-`/api/send-reminders`).
3. **במכשיר** — לחץ "הפעל התראות" ביומן ואשר. באייפון: קודם "הוסף למסך הבית" (Web Push נתמך רק ב-PWA מותקן, iOS 16.4+).

הזרימה: `pg_cron` (כל דקה) → `/api/send-reminders` → מאתר תזכורות שהגיע זמנן → שולח Web Push לכל המכשירים הרשומים.

## מבנה

```
src/
  app/            layout + globals + עמוד הבית (היומן)
  components/
    Toast.tsx     התראות
    tasks/
      ui.tsx        theme tokens + סט אייקונים (SVG)
      tasks logic   → ../../lib/tasks.ts
      TaskJournal.tsx  מעטפת: דשבורד, סרגל צד, לוח שנה
      views.tsx        אג'נדה / טבלה / קנבן / אנליטיקות
      TaskModal.tsx    עריכת משימה + שלבים
  lib/
    tasks.ts      מודל + store + מנוע סנכרון ל-Supabase
    supabase.ts   client (משתני הסביבה של הפרויקט הזה בלבד)
```

## הערה על אבטחה

היומן בנוי כיומן אישי אחד ללא התחברות — מדיניות ה-RLS פתוחה למפתח ה-anon.
כל מי שיש לו את הקישור רואה את אותן משימות. אם צריך הפרדה בין משתמשים או הגנת סיסמה — יש להוסיף Supabase Auth ולהדק את מדיניות ה-RLS.
