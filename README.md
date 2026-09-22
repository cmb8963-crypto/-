# chaimbreuer.co.il

| נתיב | מה זה |
|---|---|
| `/` (`index.html`) | דף האבחון הציבורי "מי מנהל את מי?" |
| `/dashboard/` | דשבורד הלידים של האבחון |
| `/app/` | **מערכת הניהול הפרטית**: ניהול העסק (CRM, סלים, יומן, תשלומים, יעדים, רווח והפסד, מיילים), כלכלת המשפחה, אבחון |
| `/portal/` | **האזור האישי של הלקוחות** |

הנתונים לא נמצאים במאגר הזה. הם נשמרים בגיליון Google פרטי דרך Google Apps Script. הוראות התקנה ב-[docs/SETUP.md](docs/SETUP.md).

## מבנה הקוד

```
shared/core.js             חישובים: סלים, חובות, יעדים, תקציב (משותף לדפדפן ולשרת)
shared/email-templates.js  6 תבניות המייל המעוצבות
shared/api.js              תקשורת עם השרת + מצב הדגמה (?demo=1)
shared/config.js           כתובת השרת (Web app URL)
app/                       מסך הניהול (business.js, family.js, importers.js, ui.js, app.js)
app/vendor/                SheetJS ו-pdf.js, מאוחסנים באתר עצמו
portal/                    האזור האישי ללקוח
apps-script/src/Server.js  השרת (Apps Script)
apps-script/build.sh       בונה את apps-script/dist/Code.gs, קובץ אחד להדבקה בעורך
```

אחרי כל שינוי ב-`shared/` או ב-`apps-script/src/` צריך להריץ `apps-script/build.sh`, ולהדביק מחדש את `dist/Code.gs` בעורך Apps Script.
