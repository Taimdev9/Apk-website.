# Apk-website.
# HTML → APK
موقع يحوّل ملفات HTML أو ZIP إلى تطبيق أندرويد (APK) مع اختيار الاسم والأيقونة.

## المميزات
- اختيار اسم التطبيق.
- اختيار صورة التطبيق من الهاتف (تُقص لجميع المقاسات تلقائياً).
- رفع ملف `.html` أو `.zip` (يجب أن يحتوي على `index.html`).
- إنتاج ملف APK (debug) جاهز للتثبيت المباشر.

## متطلبات التشغيل
- Node.js 18+
- JDK 17
- Android SDK
- Cordova (`npm install -g cordova`)

## تشغيل محلي
```bash
npm install
npm start
