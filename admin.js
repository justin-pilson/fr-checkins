(() => {
  const API = window.API_URL;
  const TZ = "America/Vancouver";
  const $ = (id) => document.getElementById(id);
  let pass = "";
  try { pass = sessionStorage.getItem("fr_pass") || ""; } catch (_) {}
  let data = null;
  let filter = "all";
  let confirming = null;

  const fmtTime = (d) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: TZ }).format(d);
  const fmtDay = (d) => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: TZ }).format(d);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const join = (a) => a.length < 3 ? a.join(" & ") : a.slice(0, -1).join(", ") + " & " + a[a.length - 1];
  const isTest = (m) => (m && m.role) === "Test account";
  const bookingLink = () => location.origin + "/";

  function toast(msg) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 3200);
  }

  async function call(op, extra = {}) {
    const r = await fetch(`${API}?action=admin`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "admin", op, passcode: pass, ...extra }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || "Something went wrong."); e.status = r.status; throw e; }
    return j;
  }

  async function load() {
    data = await call("list");
    render();
  }

  function render() {
    const { members, bookings, hosts, google } = data;
    const hostName = (id) => (hosts.find((h) => h.id === id) || {}).name || id;
    const active = bookings.filter((b) => b.status === "booked");
    const bookedIds = new Set(active.map((b) => b.member_id));
    const memberById = Object.fromEntries(members.map((m) => [m.id, m]));
    const execs = members.filter((m) => !isTest(m));
    const execsBooked = execs.filter((m) => bookedIds.has(m.id)).length;

    // google banner
    const g = $("google");
    const pending = active.filter((b) => b.calendar_status !== "sent").length;
    if (!google.connected) {
      g.className = "banner warn";
      g.innerHTML = google.keys_set
        ? `<p><b>Google Calendar isn't connected yet.</b> Bookings still save, but invites only go out once you connect.</p><button class="btn" id="connect" type="button">Connect Google Calendar</button>`
        : `<p><b>Google Calendar isn't set up yet.</b> Bookings still save here, and invites go out as soon as it's connected.</p>`;
    } else if (pending) {
      g.className = "banner warn";
      g.innerHTML = `<p><b>${pending} booking${pending === 1 ? " is" : "s are"} missing a calendar invite.</b> Invites send from ${esc(google.email || "your Google account")}.</p><button class="btn" id="sync" type="button">Send invites now</button>`;
    } else {
      g.className = "banner";
      g.innerHTML = `<p>Invites send automatically from <b>${esc(google.email || "your Google account")}</b>.</p><button class="btn small" id="connect" type="button">Reconnect</button>`;
    }
    $("connect")?.addEventListener("click", connect);
    $("sync")?.addEventListener("click", sync);

    // score
    const left = execs.length - execsBooked;
    $("booked-count").textContent = execsBooked;
    $("booked-of").textContent = `of ${execs.length} booked`;
    $("bar").style.width = `${execs.length ? (execsBooked / execs.length) * 100 : 0}%`;
    $("score-sub").textContent = left === 0 ? "Everyone's booked." : `${left} still need${left === 1 ? "s" : ""} to book.`;

    // still needs to book
    const groups = [["VPs", "vp", "meet with 1+ of you"], ["Coordinators & first year reps", "coord", "meet with 2+ of you"]];
    $("todo").innerHTML = left === 0 ? `<p class="all-done">Everyone's booked.</p>` : groups.map(([label, tier, rule]) => {
      const list = execs.filter((m) => m.tier === tier && !bookedIds.has(m.id));
      if (!list.length) return "";
      return `<div class="todo-group"><p class="group-label">${label} <small>· ${rule}</small></p><div class="names">${list.map((m) =>
        `<span class="tag"><span>${esc(m.first_name)} ${esc(m.last_name)}</span><small>${esc(m.role)}</small></span>`).join("")}</div></div>`;
    }).join("");
    $("copy-reminder").hidden = left === 0;

    // filters, with each person's check-in count
    const f = $("filters");
    f.innerHTML = "";
    for (const [key, label] of [["all", "Everyone"], ...hosts.map((h) => [h.id, h.name])]) {
      const n = key === "all" ? active.length : active.filter((b) => b.host_ids.includes(key)).length;
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.setAttribute("aria-pressed", String(filter === key));
      b.textContent = `${label} (${n})`;
      b.onclick = () => { filter = key; render(); };
      f.appendChild(b);
    }

    // booked list
    const shown = active.filter((b) => filter === "all" || b.host_ids.includes(filter));
    const wrap = $("booked");
    if (!shown.length) {
      wrap.innerHTML = `<p class="empty">${active.length ? "No check-ins for this person yet." : "No bookings yet. Copy the booking link from Settings below."}</p>`;
    } else {
      let html = "", lastDay = "";
      for (const b of shown) {
        const d = new Date(b.starts_at);
        const day = fmtDay(d);
        if (day !== lastDay) { html += `<p class="day-head">${esc(day)}</p>`; lastDay = day; }
        const m = memberById[b.member_id] || {};
        const status = b.calendar_status === "sent"
          ? `<span class="pill ok">Invite sent</span>`
          : b.calendar_status === "failed"
            ? `<span class="pill bad" title="${esc(b.calendar_error)}">Invite failed</span>`
            : `<span class="pill wait">Invite pending</span>`;
        html += `<div class="row${d < new Date() ? " past" : ""}">
          <div class="t">${esc(fmtTime(d))}</div>
          <div>
            <div class="who">${esc(m.first_name)} ${esc(m.last_name)}</div>
            <div class="meta">${esc(m.role)} · with ${esc(join(b.host_ids.map(hostName)))}</div>
            <div class="meta">${status}${isTest(m) ? `<span class="pill test">Test</span>` : ""}${b.meet_link ? `<a href="${esc(b.meet_link)}" target="_blank" rel="noopener">Meet link</a>` : ""}</div>
            ${b.note ? `<div class="note">“${esc(b.note)}”</div>` : ""}
          </div>
          ${confirming === b.id ? "" : `<button class="cancel" data-id="${esc(b.id)}" type="button">Cancel</button>`}
          ${confirming === b.id ? `<div class="confirm" role="group"><p>Cancel ${esc(m.first_name)}'s check-in? Everyone on the invite gets a cancellation email, and ${esc(m.first_name)} can book again.</p>
            <button class="btn small" data-yes="${esc(b.id)}" type="button">Yes, cancel it</button><button class="link" data-keep type="button">Keep it</button></div>` : ""}
        </div>`;
      }
      wrap.innerHTML = html;
      wrap.querySelectorAll(".cancel").forEach((btn) => btn.addEventListener("click", () => { confirming = btn.dataset.id; render(); }));
      wrap.querySelector("[data-keep]")?.addEventListener("click", () => { confirming = null; render(); });
      wrap.querySelector("[data-yes]")?.addEventListener("click", (e) => cancel(e.currentTarget.dataset.yes));
    }
    $("share-link").value = bookingLink();
  }

  async function cancel(id) {
    const b = data.bookings.find((x) => x.id === id);
    const m = data.members.find((x) => x.id === b.member_id) || {};
    confirming = null;
    try { await call("cancel", { id }); toast(`Cancelled ${m.first_name}'s check-in.`); await load(); }
    catch (e) { toast(e.message); render(); }
  }
  async function sync() {
    try { const r = await call("sync"); toast(`Sent ${r.count} invite${r.count === 1 ? "" : "s"}.`); await load(); }
    catch (e) { toast(e.message); }
  }
  async function connect() {
    try { const r = await call("connect_url", { return_to: location.origin }); location.href = r.url; }
    catch (e) { toast(e.message); }
  }

  $("copy-reminder").addEventListener("click", async () => {
    const booked = new Set(data.bookings.filter((b) => b.status === "booked").map((b) => b.member_id));
    const names = data.members.filter((m) => !isTest(m) && !booked.has(m.id)).map((m) => m.first_name);
    const msg = `Hi ${join(names)}! Friendly reminder to book your 15 min check-in with the internal team: ${bookingLink()}`;
    try { await navigator.clipboard.writeText(msg); $("copied").hidden = false; } catch (_) { prompt("Copy this message:", msg); }
  });
  $("copy-link").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(bookingLink()); toast("Link copied."); } catch (_) { $("share-link").select(); }
  });
  $("pass-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const np = $("newpass").value.trim();
    const msg = $("pass-msg");
    try {
      await call("set_passcode", { new_passcode: np });
      pass = np; try { sessionStorage.setItem("fr_pass", pass); } catch (_) {}
      msg.textContent = "Saved. Use the new passcode next time."; msg.hidden = false; $("newpass").value = "";
    } catch (ex) { msg.textContent = ex.message; msg.hidden = false; }
  });

  async function open() {
    try {
      await load();
      $("gate").hidden = true; $("dash").hidden = false;
      try { sessionStorage.setItem("fr_pass", pass); } catch (_) {}
      const q = new URLSearchParams(location.search).get("google");
      if (q) {
        history.replaceState(null, "", location.pathname);
        if (q === "connected") {
          toast("Google Calendar connected.");
          if (data.bookings.some((b) => b.status === "booked" && b.calendar_status !== "sent")) await sync();
        } else toast("Google didn't connect. Try again.");
      }
    } catch (e) {
      $("gate").hidden = false; $("dash").hidden = true;
      if (pass) { $("gate-error").textContent = e.status === 401 ? "That passcode didn't work." : e.message; $("gate-error").hidden = false; }
      try { sessionStorage.removeItem("fr_pass"); } catch (_) {}
    }
  }
  $("gate-form").addEventListener("submit", (e) => { e.preventDefault(); pass = $("pass").value; open(); });
  if (pass) open();
})();
