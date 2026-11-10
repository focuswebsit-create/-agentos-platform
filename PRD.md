# PRD — AgentOS Commercial SaaS v1.0

## 1. בעיה והבטחת ערך
לבעל עסק אין זמן או מומחיות לתכנת סוכנים, לחבר מודלים, לשלוט בהוצאות ולבדוק פעולות. AgentOS מאפשרת לבנות ולהפעיל עובדים דיגיטליים בפיקוח, ללא קוד, עם תוצאות שקופות ומנוי צפוי.

## 2. קהל יעד
כל ענפי העסקים, בשלב ראשון עסקים שמוכנים להשתמש בממשק שירות-עצמי בישראל. פותחים את השוק רוחבית בעזרת **Job-to-be-done** ולא בניית מוצר ייעודי לכל מקצוע.
- בעל עסק: רוצה תוצאה בלי ידע טכני; רוכש ומשלם.
- מנהל תפעול/שיווק: בונה צוות, מאשר פעולות, רואה איכות.
- עובד: מפעיל סוכנים מותרים וצופה בתוצרים.
- Platform Super Admin: רואה תמיכה, חיובים, תקלות, בריאות מערכת — לא תוכן פרטי כברירת מחדל.

## 3. תבניות השקה רב-ענפיות
1. **Research → Writer → Reviewer:** מחקר תוכן, טיוטה ובקרה; מתאים למגוון עסקים.
2. **Customer Inquiry Triage → Draft → Approval:** קליטת טקסט, סיווג והצעת תגובה; שליחה חיצונית דורשת אינטגרציה מאושרת ופעולת אישור.
3. **Document Q&A / Summary:** העלאת PDF/TXT (לפי מגבלות MIME וגודל), חילוץ, תשובות עם ייחוס לקטעי מקור.
4. **Marketing Content Kit:** בריף → מספר רעיונות → תוכנית פרסום; הפצת תוכן חיצונית *לא* מבוצעת אוטומטית ב-MVP.
לכל תבנית: שם, תיאור, use-cases, input schema, agent versions, tool requirements, estimated usage, sample output, draft installation, test and publish. תבניות מערכת הן read-only; התקנה יוצרת עותק ארגוני.

## 4. מסע לקוח
Landing → Pricing → Signup/Signin → Create workspace → Choose trial/plan → (hosted checkout if paid) → Onboarding wizard → Create from template / blank → Playground → Publish → Start run → View trace/result → Usage/Billing → Renewal/Upgrade/Cancel.
**Activation metric:** יצירת סוכן + הרצה אמיתית מוצלחת + צפייה בתוצר בתוך 10 דקות, יעד לבדיקה לא הבטחה.

## 5. MVP P0 — חייב לפני חיוב לקוחות
- שיווק: דף בית, מחירון, Features, Templates, FAQ, Security/Privacy, Terms, Contact, SEO בסיסי, analytics consent.
- זהות: Supabase Auth, workspaces/organizations, invitations, role-based access, secure org switching, MFA ל-superadmin.
- Agent Studio: Agent draft CRUD, versioned publish, provider/model, prompt, tool allowlist, max_steps/max_spend, test playground.
- Execution: provider אמיתי אחד לפחות, run state machine, checkpoint, trace, usage ledger, cancellation, backoff/idempotency.
- Teams: תהליך מחקר→כתיבה→בקרה, simple sequential handoff; בהמשך parallel מוגבל.
- Knowledge: קליטת מסמך וסיכום/חיפוש RAG מבודד לפי org.
- Safe Tooling: tool read-only אחד; פעולת outbound אחת מאושרת או simulated-only אם האינטגרציה עדיין לא מאושרת — אין להציג זאת כזמין למכירה.
- Templates: 3 שימושים מוכנים + 'blank agent'; onboarding עם דוגמה ללא נתוני לקוח.
- Plans + Billing: trial state, 3 paid tiers, entitlement and quotas enforced server-side; checkout + verified webhooks + billing portal + cancellation; בחר ספק יחיד ל-live.
- Super Admin: overview, orgs, subscriptions, usage/cost, support incidents, feature flags, audit, safe suspensions.
- Safety: tenant RLS + server auth, approval, prompt-injection resistant tool policy, no secrets in prompts, protections for billable usage.

## 6. P1 — אחרי פיילוט
מסלולים שנתיים, top-up עצמי, יותר אינטגרציות OAuth, schedules, graphical workflow editor, multi-language, referrals, template analytics, team collaboration, advanced export/reporting.

## 7. Out of scope ל-MVP
Marketplace פתוח, white-label reseller, אינטגרציות לכל CRM בעולם, הרצת קוד שרירותי, shell tools, שרתי MCP חיצוניים בלתי מפוקחים, פעולה כספית אוטונומית, תחום רגולטורי מקצועי ללא פיקוח, autonomous swarms בלתי חסומים.

## 8. מדדים
- Signup → Activated (first value), 7-day retention, trial → paid, 30/60-day paid retention, churn, MRR collected, refunds, gross margin after direct variable costs, median first-value time, run success rate excluding user cancellations, customer support tickets per account.
- אירועים: marketing CTA clicked, signup, workspace created, template installed, first run requested/completed, subscription activated, payment failure, cancellation reason. ללא העברת תוכן פניות רגיש ל-analytics.

## 9. Design constraints
RTL Hebrew first; English optional; responsive; WCAG-friendly; no auto-action hidden behind 'Run'; visible estimates, exact tool permissions, statuses, full empty/error/loading states. מודלים ותמחורים מגדירים config; לא hardcode.
