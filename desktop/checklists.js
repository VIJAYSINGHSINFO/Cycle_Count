/* Stowra console: checklist templates (administrators). Vehicle checklists today; the same editor serves HSSEQ later.
   Editing a template never changes checklists already filled in: each one keeps a copy of the questions as they were. */
(() => {
"use strict";
let C = null;
// The database allows one active checklist per slot (vehicle, when, client): explain that in plain words
const friendly = async fn => { try { return await fn(); } catch (e) { if (/slot_idx|duplicate key|already exists/i.test(e && e.message || "")) throw new Error("Another checklist is already on for the same vehicle, step and client. Turn that one off first."); throw e; } };
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const TYPES = [["yesno", "Yes / No"], ["number", "Number"], ["text", "Text"], ["photo", "Photo"]];
const STAGE = {before: "Before loading / unloading (after dock in)", after: "Before dock out"};
const slotName = t => t.kind !== "vehicle" ? "General" : `${t.purpose === "inbound" ? "Inbound" : "Outbound"} · ${t.stage === "before" ? (t.purpose === "inbound" ? "before unloading" : "before loading") : "before dock out"}`;
const E = {t: null, items: null, dirty: false};

function page(main, ctx, id) {
  C = ctx;
  if (C.me.role !== "admin") { main.innerHTML = `<div class="empty"><h2>Administrators only</h2></div>`; return; }
  if (id === "new") return pageNew(main);
  if (id) return pageEdit(main, id);
  return pageList(main);
}

async function pageList(main) {
  let rows = []; try { rows = await C.q(C.sb.from("checklist_templates").select("*").order("purpose").order("stage").order("storer")); } catch (e) { C.fail(e); }
  const order = t => (t.purpose === "inbound" ? 0 : 1) * 10 + (t.stage === "before" ? 0 : 1);
  rows.sort((a, b) => order(a) - order(b) || (a.storer > b.storer ? 1 : -1) || (b.active - a.active));
  main.innerHTML = `<div class="pagehead"><div><h1>Checklists</h1><p class="muted small" style="margin:4px 0 0">Vehicle checklists filled in on the phone (Docks tab): one after dock in, before loading or unloading, and one before dock out. A checklist for a specific client replaces the general one for that client's vehicles. Turn a checklist off to stop asking it.</p></div>
      <a class="btn go" href="#/checklists/new">New checklist</a></div>
    ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Checklist</th><th>When</th><th>Client</th><th class="n">Questions</th><th class="n">Critical</th><th>Status</th><th>Last changed</th><th></th></tr></thead><tbody>
      ${rows.map(t => `<tr class="${t.active ? "" : "off"}"><td><a href="#/checklists/${C.esc(t.id)}"><strong>${C.esc(t.name)}</strong></a></td><td>${slotName(t)}</td><td>${t.storer ? `<span class="tag">${C.esc(t.storer)}</span>` : "All clients"}</td>
        <td class="n">${(t.items || []).length}</td><td class="n">${(t.items || []).filter(i => i.critical).length}</td><td>${t.active ? `<span class="status s-match">On</span>` : `<span class="status s-uncounted">Off</span>`}</td>
        <td class="small">${C.dt(t.updated_at)}<br><span class="muted">version ${t.version}</span></td>
        <td class="row" style="flex-wrap:nowrap"><a class="btn sm" href="#/checklists/${C.esc(t.id)}">Edit</a><button class="btn sm" data-ca="copy" data-id="${C.esc(t.id)}">Copy for a client</button><button class="btn sm ghost" data-ca="toggle" data-id="${C.esc(t.id)}" data-on="${t.active ? 0 : 1}">${t.active ? "Turn off" : "Turn on"}</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><h2>No checklists</h2><p>Run the latest database script to add the standard vehicle checklists, or create one.</p></div>`}`;
  C.cache.ckList = rows;
}

function pageNew(main, from) {
  main.innerHTML = `<div class="pagehead"><div><a href="#/checklists" class="small">All checklists</a><h1 style="margin-top:6px">${from ? "Copy for a client" : "New checklist"}</h1></div></div>
    <form class="panel" id="cknew" style="max-width:640px"><div class="grid-form">
      <label class="field" style="grid-column:1/-1">Name<input name="name" required value="${C.esc(from ? from.name + " (client)" : "")}" placeholder="e.g. Pharma inbound: before unloading"></label>
      <label class="field">Vehicle<select name="purpose"><option value="inbound" ${from && from.purpose === "inbound" ? "selected" : ""}>Inbound</option><option value="outbound" ${from && from.purpose === "outbound" ? "selected" : ""}>Outbound</option></select></label>
      <label class="field">When<select name="stage"><option value="before" ${from && from.stage === "before" ? "selected" : ""}>${STAGE.before}</option><option value="after" ${from && from.stage === "after" ? "selected" : ""}>${STAGE.after}</option></select></label>
      <label class="field" style="grid-column:1/-1">Client / storer (leave empty for all clients)<input name="storer" autocapitalize="characters" placeholder="e.g. TGD" ${from ? "required" : ""}></label></div>
      <p class="hint">${from ? `Starts with the ${(from.items || []).length} questions of "${C.esc(from.name)}". Change them on the next page.` : "You add the questions on the next page."}</p>
      <div class="row"><button class="btn primary">Create</button><a class="btn ghost" href="#/checklists">Cancel</a></div></form>`;
  $("#cknew").onsubmit = async e => {
    e.preventDefault(); const f = e.target, g = n => f.elements.namedItem(n).value.trim();
    const row = await C.run(() => friendly(() => C.q(C.sb.from("checklist_templates").insert({name: g("name"), kind: "vehicle", purpose: g("purpose"), stage: g("stage"), storer: g("storer").toUpperCase(), items: from ? JSON.parse(JSON.stringify(from.items || [])) : [], active: true, version: 1}).select().single())));
    if (row && row.id) C.go("checklists/" + row.id);
  };
}

async function pageEdit(main, id) {
  let t; try { t = await C.q(C.sb.from("checklist_templates").select("*").eq("id", id).single()); } catch { main.innerHTML = `<div class="empty"><h2>Checklist not found</h2><p><a href="#/checklists">All checklists</a></p></div>`; return; }
  E.t = t; E.items = JSON.parse(JSON.stringify(t.items || [])); E.dirty = false;
  main.innerHTML = `<div class="pagehead"><div><a href="#/checklists" class="small">All checklists</a><h1 style="margin-top:6px" id="ckh">${C.esc(t.name)}</h1>
      <span class="muted small">${slotName(t)} · ${t.storer ? "client " + C.esc(t.storer) : "all clients"} · version ${t.version} · ${t.active ? "on" : "off"}</span></div>
      <div class="row"><button class="btn primary" data-ca="save">Save checklist</button></div></div>
    <div class="panel" style="max-width:980px"><label class="field" style="max-width:520px">Name<input id="ckname" value="${C.esc(t.name)}"></label>
      <p class="hint">A <strong>critical</strong> question answered No (or a number outside its range) fails the checklist: the team must stop, and a supervisor accepts or rejects the vehicle on the console. Other No answers are recorded as issues.</p>
      <ol class="ckedit" id="ckitems"></ol>
      <div class="row" style="margin-top:10px"><button class="btn" data-ca="add">Add question</button><span class="small muted" id="ckdirty"></span></div></div>`;
  renderItems();
  $("#ckname").oninput = () => mark();
}
function mark() { E.dirty = true; const d = $("#ckdirty"); if (d) d.textContent = "Unsaved changes"; }
function renderItems() {
  const box = $("#ckitems"); if (!box) return;
  box.innerHTML = E.items.map((it, i) => `<li data-i="${i}">
    <div class="ckline"><span class="ckn">${i + 1}</span><input class="search" data-f="text" value="${C.esc(it.text || "")}" placeholder="Question, e.g. Wheel chocks in place" style="flex:1;min-width:220px">
      <select class="search" data-f="type" style="min-width:0">${TYPES.map(([k, l]) => `<option value="${k}" ${it.type === k ? "selected" : ""}>${l}</option>`).join("")}</select>
      <button class="btn sm ghost" data-ca="up" data-i="${i}" ${i ? "" : "disabled"} aria-label="Move up">▲</button><button class="btn sm ghost" data-ca="down" data-i="${i}" ${i < E.items.length - 1 ? "" : "disabled"} aria-label="Move down">▼</button>
      <button class="btn sm danger" data-ca="del" data-i="${i}" aria-label="Delete question">Delete</button></div>
    <div class="ckopts">
      ${it.type === "photo" || it.type === "text" ? "" : `<label class="check small"><input type="checkbox" data-f="critical" ${it.critical ? "checked" : ""}> Critical</label>`}
      ${it.type === "yesno" || it.type === "number" ? `<label class="check small"><input type="checkbox" data-f="na" ${it.na ? "checked" : ""}> N/A allowed</label>` : ""}
      ${it.type === "yesno" ? `<label class="check small"><input type="checkbox" data-f="photo_on_no" ${it.photo_on_no ? "checked" : ""}> Photo required when No</label>` : ""}
      ${it.type === "number" ? `<label class="small">Allowed from <input class="search mini" data-f="min" type="number" step="any" value="${C.esc(it.min ?? "")}"></label><label class="small">to <input class="search mini" data-f="max" type="number" step="any" value="${C.esc(it.max ?? "")}"></label><label class="small">Unit <input class="search mini" data-f="unit" value="${C.esc(it.unit || "")}" placeholder="°C"></label>` : ""}
      ${it.type === "photo" || it.type === "text" ? `<label class="check small"><input type="checkbox" data-f="required" ${it.required !== false ? "checked" : ""}> Required</label>` : ""}
    </div></li>`).join("") || `<p class="muted small">No questions yet.</p>`;
  $$("#ckitems li").forEach(li => {
    const i = +li.dataset.i;
    $$("[data-f]", li).forEach(el => el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", () => {
      const it = E.items[i], f = el.dataset.f;
      if (el.type === "checkbox") { if (f === "required") it.required = el.checked ? undefined : false; else if (el.checked) it[f] = true; else delete it[f]; }
      else if (f === "min" || f === "max") { if (el.value === "") delete it[f]; else it[f] = Number(el.value); }
      else if (f === "type") { it.type = el.value; if (it.type !== "yesno") delete it.photo_on_no; if (it.type !== "number") { delete it.min; delete it.max; delete it.unit; } if (it.type === "photo" || it.type === "text") { delete it.critical; delete it.na; } mark(); renderItems(); return; }
      else it[f] = el.value;
      mark();
    }));
  });
}
async function save() {
  const name = $("#ckname").value.trim(), items = E.items.map(it => ({...it, text: String(it.text || "").trim()}));
  if (!name) return C.toast("Enter a name.", true);
  const blank = items.findIndex(it => !it.text); if (blank >= 0) return C.toast(`Question ${blank + 1} has no text.`, true);
  const badRange = items.findIndex(it => it.type === "number" && it.min !== undefined && it.max !== undefined && it.min > it.max); if (badRange >= 0) return C.toast(`Question ${badRange + 1}: "from" is above "to".`, true);
  if (!items.length) return C.toast("Add at least one question.", true);
  if (await C.run(() => C.q(C.sb.from("checklist_templates").update({name, items, version: (E.t.version || 1) + 1, updated_at: new Date().toISOString()}).eq("id", E.t.id)), "Checklist saved. New checklists use it from now on.")) pageEdit($("#main"), E.t.id);
}
function nextId() { let n = 0; E.items.forEach(it => { const m = /^i(\d+)$/.exec(it.id || ""); if (m) n = Math.max(n, +m[1]); }); return "i" + (n + 1); }

document.addEventListener("click", async e => {
  const b = e.target.closest("[data-ca]"); if (!b || !C) return;
  const i = +b.dataset.i;
  switch (b.dataset.ca) {
    case "add": E.items.push({id: nextId(), text: "", type: "yesno"}); mark(); renderItems(); const ins = $$("#ckitems [data-f=text]"); if (ins.length) ins[ins.length - 1].focus(); break;
    case "del": if (C.confirmTwice(b, "ckdel" + i, "Tap again")) { E.items.splice(i, 1); mark(); renderItems(); } break;
    case "up": [E.items[i - 1], E.items[i]] = [E.items[i], E.items[i - 1]]; mark(); renderItems(); break;
    case "down": [E.items[i + 1], E.items[i]] = [E.items[i], E.items[i + 1]]; mark(); renderItems(); break;
    case "save": save(); break;
    case "toggle": if (await C.run(() => friendly(() => C.q(C.sb.from("checklist_templates").update({active: b.dataset.on === "1", updated_at: new Date().toISOString()}).eq("id", b.dataset.id))), b.dataset.on === "1" ? "Checklist turned on" : "Checklist turned off")) pageList($("#main")); break;
    case "copy": { const t = (C.cache.ckList || []).find(x => x.id === b.dataset.id); if (t) pageNew($("#main"), t); break; }
  }
});
window.addEventListener("beforeunload", e => { if (E.dirty && location.hash.startsWith("#/checklists/")) { e.preventDefault(); e.returnValue = ""; } });

window.CCChecklists = {page};
})();
