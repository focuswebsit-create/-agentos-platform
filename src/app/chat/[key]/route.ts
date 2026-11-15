import { randomBytes } from "node:crypto";
import { connection } from "next/server";
import { getWidgetInfo } from "@/modules/runtime/chat";

const KEY_PATTERN = /^wk_[A-Za-z0-9_-]{20,64}$/;
const ORIGIN_PATTERN = /^https:\/\/[a-z0-9.-]+(:\d{1,5})?$/i;

/**
 * GET /chat/:key — the hosted chat window, embeddable by iframe.
 *
 * Served as a self-contained document with its own Content-Security-Policy:
 *   - frame-ancestors: the widget's allowed origins only ('self' otherwise),
 *     enforced by the browser, so other sites cannot embed it;
 *   - scripts and styles by nonce only, connect-src 'self', no forms, no base.
 * Every message is inserted with textContent - never as HTML - so nothing a
 * visitor, an agent or a staff member writes can execute.
 */
export async function GET(_request: Request, context: RouteContext<"/chat/[key]">) {
  await connection();
  const { key } = await context.params;
  const info = KEY_PATTERN.test(key) ? await getWidgetInfo(key) : null;

  if (!info || !info.enabled) {
    return new Response("הצ'אט אינו זמין.", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const nonce = randomBytes(16).toString("base64");
  const ancestors = info.allowedOrigins.filter((o) => ORIGIN_PATTERN.test(o));
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    "connect-src 'self'",
    "img-src 'self' data:",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors 'self'${ancestors.length ? ` ${ancestors.join(" ")}` : ""}`,
  ].join("; ");

  const config = JSON.stringify({
    key,
    greeting: info.greeting ?? "שלום! איך אפשר לעזור?",
  }).replace(/</g, "\\u003c");
  const title = info.agentName.replace(/[<>&"]/g, "");

  const html = `<!doctype html>
<html lang="he" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style nonce="${nonce}">
  *{box-sizing:border-box} html,body{height:100%;margin:0}
  body{font-family:system-ui,-apple-system,"Segoe UI",Arial,sans-serif;background:#f6f7fb;color:#111;display:flex;flex-direction:column}
  @media (prefers-color-scheme: dark){body{background:#0f1115;color:#eee}.b{background:#1b1f27!important;color:#eee!important}}
  header{padding:12px 16px;font-weight:600;background:#4f46e5;color:#fff}
  #log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
  .b{max-width:85%;padding:9px 12px;border-radius:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;background:#fff;box-shadow:0 1px 2px #0001}
  .visitor{align-self:flex-start;background:#4f46e5!important;color:#fff!important}
  .agent,.human{align-self:flex-end}
  .human{border:1px solid #4f46e5}
  .note{align-self:center;font-size:12px;opacity:.7}
  footer{display:flex;gap:8px;padding:10px;border-top:1px solid #0001}
  textarea{flex:1;resize:none;height:44px;padding:10px;border-radius:10px;border:1px solid #0002;font:inherit}
  button{padding:0 16px;border:0;border-radius:10px;background:#4f46e5;color:#fff;font:inherit;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  .sr{position:absolute;left:-9999px}
</style>
</head>
<body>
<header>${title}</header>
<main id="log" aria-live="polite"></main>
<footer>
  <label for="msg" class="sr">הודעה</label>
  <textarea id="msg" maxlength="2000" placeholder="כתבו הודעה…"></textarea>
  <button id="send" type="button">שליחה</button>
</footer>
<script nonce="${nonce}">
(function(){
  var cfg=${config};
  var log=document.getElementById("log"), box=document.getElementById("msg"), btn=document.getElementById("send");
  var storeKey="agentos-chat-"+cfg.key, token=null, seen=0;
  try{token=sessionStorage.getItem(storeKey)}catch(e){}
  function add(cls,text){var d=document.createElement("div");d.className=cls==="note"?"note":"b "+cls;d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight}
  function headers(){return {"content-type":"application/json","x-visitor-token":token||""}}
  async function ensure(){
    if(token) return true;
    var r=await fetch("/api/chat/"+cfg.key+"/conversations",{method:"POST"});
    if(!r.ok){add("note",r.status===429?"יותר מדי שיחות חדשות. נסו שוב מאוחר יותר.":"הצ'אט אינו זמין כרגע.");return false}
    token=(await r.json()).token; try{sessionStorage.setItem(storeKey,token)}catch(e){}
    return true;
  }
  async function refresh(){
    if(!token) return;
    var r=await fetch("/api/chat/"+cfg.key+"/messages",{headers:headers()});
    if(!r.ok) return;
    var data=await r.json();
    for(var i=seen;i<data.messages.length;i++){add(data.messages[i].role,data.messages[i].content)}
    seen=data.messages.length;
  }
  async function send(){
    var text=box.value.trim(); if(!text) return;
    btn.disabled=true; box.value="";
    if(!(await ensure())){btn.disabled=false;return}
    add("visitor",text); seen++;
    var r=await fetch("/api/chat/"+cfg.key+"/messages",{method:"POST",headers:headers(),body:JSON.stringify({content:text})});
    if(r.ok){var d=await r.json(); if(d.reply){add("agent",d.reply);seen++} else if(d.handoff){add("note","נציג יחזור אליכם כאן בהקדם.")}}
    else{add("note",r.status===429?"הגעתם למגבלת ההודעות. נסו שוב מאוחר יותר.":"לא הצלחנו לענות כרגע. נסו שוב.")}
    btn.disabled=false; box.focus();
  }
  btn.addEventListener("click",send);
  box.addEventListener("keydown",function(e){if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send()}});
  add("agent",cfg.greeting);
  refresh(); setInterval(refresh,5000);
})();
</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": csp,
      "cache-control": "no-store",
    },
  });
}
