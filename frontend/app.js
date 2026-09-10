const app = document.querySelector("#app");
let me, poll, adminData;
let chosen = { snack: null, drink: null };

const api = async (url, options = {}) => {
  const response = await fetch(`/api${url}`, { credentials: "include", headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({ message: "伺服器回應錯誤，請重新啟動後端後再試一次。" }));
  if (!response.ok) throw new Error(data.message || "操作失敗");
  return data;
};
const esc = value => String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
const dt = value => value ? new Date(value).toLocaleString("zh-TW", { dateStyle: "medium", timeStyle: "short" }) : "";
const localDateTime = value => value ? value.slice(0, 16) : "";
const itemImage = item => item.image_url ? `<img class="snack-image" src="${esc(item.image_url)}" alt="${esc(item.name)}">` : `<span class="food" aria-hidden="true">${item.category === "drink" ? "🥤" : "🍪"}</span>`;

function flash(message, kind = "success") {
  const old = document.querySelector(".flash");
  old?.remove();
  const notice = document.createElement("div");
  notice.className = `flash ${kind}`;
  notice.textContent = message;
  document.body.append(notice);
  setTimeout(() => notice.remove(), 3000);
}

function login(message = "") {
  app.innerHTML = `<section class="login"><div class="ticket-head"><div class="brand"><small>CLASS SNACK VOTE</small>今日點心票選</div><p>登入後，選一個點心與一杯飲料。</p></div><form class="form" id="login"><label class="field">帳號<input name="username" required autocomplete="username" placeholder="學號"></label><label class="field">密碼<input name="password" type="password" required autocomplete="current-password"></label><button class="action primary">登入</button><p class="error">${esc(message)}</p></form></section>`;
  document.querySelector("#login").onsubmit = async event => {
    event.preventDefault();
    try { me = (await api("/auth/login", { method: "POST", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) })).user; await load(); }
    catch (error) { login(error.message); }
  };
}

function shell(content) {
  return `<div class="shell"><header class="masthead"><div class="brand"><small>CLASS SNACK VOTE</small>今日點心票選</div><div class="userbar">${esc(me.name)}<br><button class="action subtle mini" id="change-password">修改密碼</button><button class="action subtle mini" id="logout">登出</button></div></header>${content}</div>`;
}

function bindCommon() {
  document.querySelector("#logout").onclick = async () => { await api("/auth/logout", { method: "POST" }); login(); };
  document.querySelector("#change-password").onclick = async () => {
    const oldPassword = prompt("目前密碼"); if (oldPassword === null) return;
    const newPassword = prompt("新密碼（至少 6 個字元）"); if (newPassword === null) return;
    try { await api("/auth/change-password", { method: "POST", body: JSON.stringify({ oldPassword, newPassword }) }); flash("密碼修改成功"); }
    catch (error) { flash(error.message, "error"); }
  };
}

function choiceGroup(category, title) {
  const items = poll.snacks.filter(item => item.category === category);
  return `<section class="choice-section"><h2>${title} <span class="hint">${chosen[category] ? "已選擇，可重新選擇" : "請選一項"}</span></h2><div class="snacks">${items.map(item => `<button class="snack ${chosen[category] === item.id ? "selected" : ""}" data-vote-id="${item.id}"><span class="rank">#${item.rank}</span>${itemImage(item)}<h3>${esc(item.name)}</h3><p>${esc(item.description)}</p><span class="price">${item.price ? "$" + item.price : ""}</span></button>`).join("")}</div></section>`;
}

function results() {
  const sections = ["snack", "drink"].map(category => {
    const items = poll.snacks.filter(item => item.category === category);
    const max = Math.max(...items.map(item => item.votes), 1);
    return `<section class="choice-section ranking ${category}"><h2>${category === "snack" ? "點心" : "飲料"}排名</h2>${items.slice().sort((a, b) => a.rank - b.rank).map(item => `<div class="result-row"><strong>#${item.rank}</strong><div><b>${esc(item.name)}</b><div class="bar"><i style="width:${item.votes / max * 100}%"></i></div></div><strong>${item.votes} 票</strong></div>`).join("")}</section>`;
  }).join("");
  return `<section class="results"><h2>投票統計 <span class="hint">${poll.completedVoters} / 43 人已完成兩項選擇</span></h2>${sections}</section>`;
}

function student() {
  const copy = { not_started: ["尚未開始", "投票尚未開始，請等待管理員開放。"], open: ["投票進行中", "每人選一個點心與一杯飲料；投票期間可重新選擇。"], ended: ["投票已結束", "本次投票已結束"] }[poll.status];
  const info = [poll.pollDate && `供應日期：${poll.pollDate}`, poll.startAt && `投票時間：${dt(poll.startAt)} ～ ${poll.endAt ? dt(poll.endAt) : "未設定"}`].filter(Boolean).join("　｜　");
  const content = poll.status === "open" ? `${choiceGroup("snack", "選點心")}${choiceGroup("drink", "選飲料")}<p class="hint">點選品項後會立即儲存。兩區都可隨時重新選擇。</p>` : `<div class="notice">${copy[1]}</div>`;
  app.innerHTML = shell(`<section class="ticket"><div class="ticket-head"><h1>${poll.status === "ended" ? "結果揭曉" : "投票時間"}</h1><p>${info || copy[1]}</p></div><div class="content"><div class="status ${poll.status}"><i class="dot"></i>${copy[0]}</div>${content}${poll.status !== "not_started" ? results() : ""}</div></section>`);
  bindCommon();
  document.querySelectorAll("[data-vote-id]").forEach(button => button.onclick = () => submitVote(Number(button.dataset.voteId)));
}

async function submitVote(snackId) {
  try {
    const data = await api("/poll/vote", { method: "POST", body: JSON.stringify({ snackId }) });
    poll = data;
    chosen = { snack: null, drink: null, ...data.selectedSnackIds };
    flash(data.message);
    student();
  } catch (error) { flash(error.message, "error"); }
}

function admin() {
  const status = { not_started: "尚未開始", open: "投票中", ended: "已結束" }[adminData.status];
  app.innerHTML = shell(`<section class="ticket"><div class="ticket-head"><h1>投票控制台</h1><p>設定日期、管理品項、查看每位學生的投票。</p></div><div class="content"><div class="admin-grid"><div class="metric">目前狀態<b>${status}</b></div><div class="metric">已投票人數<b>${adminData.votedCount} / ${adminData.studentCount}</b><span class="hint">${adminData.completedVoters} 人完成兩項</span></div><div class="metric">可用選項<b>${adminData.snacks.filter(item => item.active).length}</b></div></div><section class="admin-section"><h2>供應與投票時間</h2><form class="schedule" id="schedule"><div class="schedule-grid"><label>要吃的日期<input name="pollDate" type="date" value="${esc(adminData.pollDate)}"></label><label>開始投票時間<input name="startAt" type="datetime-local" value="${localDateTime(adminData.startAt)}"></label><label>結束投票時間<input name="endAt" type="datetime-local" value="${localDateTime(adminData.endAt)}"></label></div><div class="actions"><button class="action primary">儲存時間設定</button><span class="hint">設為空白即取消自動排程。</span></div></form></section><div class="actions"><button class="action subtle" data-status="not_started">設為尚未開始</button><button class="action primary" data-status="open">開始投票</button><button class="action danger" data-status="ended">結束投票</button></div><section class="admin-section"><h2>新增品項</h2><form id="add-item" class="snack-form"><select name="category"><option value="snack">點心</option><option value="drink">飲料</option></select><input name="name" required placeholder="名稱"><input name="description" placeholder="簡短說明（可留白）"><input name="price" type="number" min="0" placeholder="價格（可留白）"><input name="image" type="file" accept="image/*"><button class="action primary">新增</button></form><p class="hint">圖片可不傳；上限 2 MB。</p></section><section class="admin-section"><h2>帳號 CSV 匯入</h2><div class="actions"><a class="action subtle" href="/student_accounts_template.csv" download>下載 CSV 範本</a><form id="import-users"><input name="csv" type="file" accept=".csv,text/csv" required><button class="action primary">匯入學生帳號</button></form></div><p class="hint">欄位固定為 student_id、name、password。相同學號會更新姓名與密碼。</p></section><section class="admin-section"><h2>品項與票數</h2><div class="table-wrap"><table class="table"><thead><tr><th>品項</th><th>分類</th><th>票數</th><th>狀態</th><th>操作</th></tr></thead><tbody>${adminData.snacks.map(item => `<tr><td>${item.image_url ? `<img class="preview" src="${esc(item.image_url)}" alt="">` : ""}<b>${esc(item.name)}</b><br><span class="hint">${esc(item.description || "")} ${item.price ? "$" + item.price : ""}</span></td><td>${item.category === "drink" ? "飲料" : "點心"}</td><td>${item.votes}</td><td>${item.active ? "開放" : "隱藏"}</td><td><button class="action subtle mini" data-edit="${item.id}">編輯</button><button class="action danger mini" data-delete="${item.id}">刪除</button></td></tr>`).join("")}</tbody></table></div></section><section class="admin-section"><h2>誰投了什麼</h2><div class="table-wrap"><table class="table"><thead><tr><th>學號</th><th>姓名</th><th>點心</th><th>飲料</th></tr></thead><tbody>${adminData.voteDetails.length ? adminData.voteDetails.map(row => `<tr><td>${esc(row.username)}</td><td>${esc(row.name)}</td><td>${esc(row.snack_name || "尚未選擇")}</td><td>${esc(row.drink_name || "尚未選擇")}</td></tr>`).join("") : "<tr><td colspan=\"4\">目前尚未有人投票。</td></tr>"}</tbody></table></div></section></div></section>`);
  bindCommon();
  document.querySelector("#schedule").onsubmit = saveSchedule;
  document.querySelector("#add-item").onsubmit = addItem;
  document.querySelector("#import-users").onsubmit = importUsers;
  document.querySelectorAll("[data-status]").forEach(button => button.onclick = () => updateStatus(button.dataset.status));
  document.querySelectorAll("[data-edit]").forEach(button => button.onclick = () => editItem(Number(button.dataset.edit)));
  document.querySelectorAll("[data-delete]").forEach(button => button.onclick = () => deleteItem(Number(button.dataset.delete)));
}

async function refreshAdmin(data, message) { adminData = data; admin(); if (message) flash(message); }
async function updateStatus(status) { try { const data = await api("/admin/status", { method: "PUT", body: JSON.stringify({ status }) }); await refreshAdmin(data, data.message); } catch (error) { flash(error.message, "error"); } }
async function saveSchedule(event) { event.preventDefault(); try { const data = await api("/admin/schedule", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) }); await refreshAdmin(data, data.message); } catch (error) { flash(error.message, "error"); } }
function fileToDataUrl(file) { return new Promise((resolve, reject) => { if (!file || file.size === 0) return resolve(""); if (file.size > 2 * 1024 * 1024) return reject(new Error("圖片最大 2 MB")); const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("圖片讀取失敗")); reader.readAsDataURL(file); }); }
async function addItem(event) { event.preventDefault(); try { const form = new FormData(event.target); const body = Object.fromEntries(form); body.imageUrl = await fileToDataUrl(form.get("image")); delete body.image; const data = await api("/admin/snacks", { method: "POST", body: JSON.stringify(body) }); await refreshAdmin(data, "品項新增成功"); } catch (error) { flash(error.message, "error"); } }
async function deleteItem(id) { if (!confirm("確定刪除此品項？已投給它的票也會一併移除。")) return; try { const data = await api(`/admin/snacks/${id}`, { method: "DELETE" }); await refreshAdmin(data, data.message); } catch (error) { flash(error.message, "error"); } }
async function editItem(id) { const item = adminData.snacks.find(row => row.id === id); const name = prompt("名稱", item.name); if (name === null) return; const description = prompt("簡短說明", item.description || ""); if (description === null) return; const price = prompt("價格", item.price || ""); if (price === null) return; const category = confirm("確定＝點心；取消＝飲料") ? "snack" : "drink"; const active = confirm("確定＝開放；取消＝隱藏"); let imageUrl = item.image_url || ""; const save = async () => { try { const data = await api(`/admin/snacks/${id}`, { method: "PUT", body: JSON.stringify({ name, description, price, category, active, imageUrl }) }); await refreshAdmin(data, "品項修改成功"); } catch (error) { flash(error.message, "error"); } }; if (!confirm("要更換或新增圖片嗎？")) return save(); const picker = document.createElement("input"); picker.type = "file"; picker.accept = "image/*"; picker.onchange = async () => { try { imageUrl = await fileToDataUrl(picker.files[0]); await save(); } catch (error) { flash(error.message, "error"); } }; picker.click(); }
async function importUsers(event) { event.preventDefault(); const file = new FormData(event.target).get("csv"); if (!file?.size) return; try { const csvText = await file.text(); const data = await api("/admin/users/import", { method: "POST", body: JSON.stringify({ csvText }) }); await refreshAdmin(data, data.message); } catch (error) { flash(error.message, "error"); } }
async function load() { try { me = (await api("/auth/me")).user; if (me.role === "admin") { adminData = await api("/admin/dashboard"); admin(); } else { poll = await api("/poll"); chosen = { snack: null, drink: null, ...poll.selectedSnackIds }; student(); } } catch { login(); } }
load();
