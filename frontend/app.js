// @ts-nocheck
const API_BASE = "http://localhost:4000";
const $ = (id) => document.getElementById(id);

const loginView      = $("loginView");
const dashboardView  = $("dashboardView");
const identifierInput= $("identifier");
const passwordInput  = $("password");
const loginBtn       = $("loginBtn");
const logoutBtn      = $("logoutBtn");
const statusEl       = $("status");
const welcomeText    = $("welcomeText");

// ─── Utilities ────────────────────────────────────────────────────────────────

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setStatus(msg, type = "info") {
  if (!msg) { statusEl.textContent = ""; statusEl.className = ""; return; }
  statusEl.textContent = msg;
  if (type === "ok")  statusEl.className = "status-ok mt-3";
  else if (type === "err") statusEl.className = "status-err mt-3";
  else statusEl.className = "mt-3 text-blue-300/70 text-xs font-mono tracking-wide";
}

function formatXP(xp) {
  if (xp >= 1_000_000) return (xp / 1_000_000).toFixed(2) + " MB";
  if (xp >= 1_000)     return (xp / 1_000).toFixed(1) + " kB";
  return String(xp);
}

function showLogin() {
  loginView.classList.remove("hidden");
  dashboardView.classList.add("hidden");
  setStatus("");
  passwordInput.value = "";
  clearCharts();
  clearProfileSummary();
}

function showDashboard() {
  loginView.classList.add("hidden");
  dashboardView.classList.remove("hidden");
}

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, { credentials: "include", ...options });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error || `Request failed (${res.status})`;
    throw new Error(msg + (data?.details ? `\n${data.details}` : ""));
  }
  return data;
}

function clearProfileSummary() {
  ["qsUsername","qsFirstName","qsLastName","qsXP","qsRatio","qsPass","qsFail"]
    .forEach(id => setText(id, "—"));
  const ab = $("auditBars");
  if (ab) ab.innerHTML = "";
}

// ─── Animated counter ─────────────────────────────────────────────────────────

function animateCount(el, from, to, duration = 1200, format = v => String(Math.round(v))) {
  if (!el) return;
  const start = performance.now();
  function tick(now) {
    const t = Math.min((now - start) / duration, 1);
    // Ease out cubic
    const ease = 1 - Math.pow(1 - t, 3);
    el.textContent = format(from + (to - from) * ease);
    if (t < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

// ─── Load stats ───────────────────────────────────────────────────────────────

async function loadStats() {
  const stats = await api("/api/stats");

  if (stats.me?.login) {
    welcomeText.textContent = `◈ ${stats.me.login.toUpperCase()} — ONLINE`;
  }

  const me    = stats.me    || {};
  const audit = stats.audit || {};
  const pf    = stats.passFail || {};

  setText("qsUsername",  me.login     ?? "—");
  setText("qsFirstName", me.firstName ?? "—");
  setText("qsLastName",  me.lastName  ?? "—");

  // Animated XP — use server-computed totalXP (includes checkpoint items)
  const totalXP = Number(stats.totalXP || 0);
  const xpEl = $("qsXP");
  if (xpEl) animateCount(xpEl, 0, totalXP, 1400, v => formatXP(Math.round(v)));

  // Animated ratio
  const ratio = audit.ratio ? Number(audit.ratio) : null;
  const ratioEl = $("qsRatio");
  if (ratioEl && ratio) animateCount(ratioEl, 0, ratio, 1200, v => v.toFixed(1));
  else setText("qsRatio", "—");

  // Animated pass/fail
  const passEl = $("qsPass");
  const failEl = $("qsFail");
  if (passEl) animateCount(passEl, 0, pf.pass ?? 0, 1000);
  if (failEl) animateCount(failEl, 0, pf.fail ?? 0, 1000);

  // Charts
  renderXPChart(stats.xpByProject);
  renderPassFailChart(stats.passFail);
  renderAuditBars(stats.audit);

  return stats;
}

// ─── Events ───────────────────────────────────────────────────────────────────

loginBtn.addEventListener("click", async () => {
  const identifier = identifierInput.value.trim();
  const password   = passwordInput.value;
  if (!identifier || !password) { setStatus("Please enter identifier + password", "err"); return; }
  setStatus("Establishing connection...", "info");
  loginBtn.disabled = true;
  try {
    await api("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password })
    });
    setStatus("Access granted ✓ Loading data...", "ok");
    showDashboard();
    await loadStats();
    setStatus("");
  } catch (e) {
    setStatus(`Access denied: ${e.message}`, "err");
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch {}
  showLogin();
});

// Allow Enter key on login form
[identifierInput, passwordInput].forEach(el =>
  el?.addEventListener("keydown", e => { if (e.key === "Enter") loginBtn.click(); })
);

// Auto-login on page load
(async function init() {
  try {
    await loadStats();
    showDashboard();
    setStatus("");
  } catch {
    showLogin();
  }
})();

// ─── SVG helpers ──────────────────────────────────────────────────────────────

function clearCharts() {
  [$("xpChart"), $("passFailChart")].forEach(el => { if (el) el.innerHTML = ""; });
}

const NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs) {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

// ─── XP Bar Chart — animated with tooltips ────────────────────────────────────

function renderXPChart(data) {
  const svg = $("xpChart");
  if (!svg) return;
  svg.innerHTML = "";

  if (!Array.isArray(data) || data.length === 0) {
    const t = svgEl("text", { x:20, y:30, "font-size":"15", fill:"rgba(255,255,255,0.5)" });
    t.textContent = "No XP data"; svg.appendChild(t); return;
  }

  const top    = data.slice(0, 10);
  const width  = Number(svg.getAttribute("width"))  || 1100;
  const height = Number(svg.getAttribute("height")) || 380;

  // Generous bottom padding — labels live ENTIRELY below padT+chartH
  const padL = 72, padR = 30, padT = 36, padB = 120;
  const chartW = width  - padL - padR;
  const chartH = height - padT - padB;

  const maxXP   = Math.max(...top.map(d => d.xp));
  const niceMax = Math.ceil(maxXP / 10000) * 10000 || 10000;
  const ticks   = 5;

  // ── Defs ──
  const defs = svgEl("defs", {});

  const grad = svgEl("linearGradient", { id:"barGrad", x1:"0", y1:"0", x2:"0", y2:"1" });
  grad.appendChild(svgEl("stop", { offset:"0%",   "stop-color":"#a78bfa" }));
  grad.appendChild(svgEl("stop", { offset:"60%",  "stop-color":"#7c3aed" }));
  grad.appendChild(svgEl("stop", { offset:"100%", "stop-color":"#4c1d95" }));
  defs.appendChild(grad);

  const gradHov = svgEl("linearGradient", { id:"barGradHov", x1:"0", y1:"0", x2:"0", y2:"1" });
  gradHov.appendChild(svgEl("stop", { offset:"0%",   "stop-color":"#c4b5fd" }));
  gradHov.appendChild(svgEl("stop", { offset:"100%", "stop-color":"#7c3aed" }));
  defs.appendChild(gradHov);

  const filter = svgEl("filter", { id:"glow", x:"-20%", y:"-20%", width:"140%", height:"140%" });
  const feBlur = svgEl("feGaussianBlur", { stdDeviation:"4", result:"blur" });
  const feMerge = svgEl("feMerge", {});
  feMerge.appendChild(svgEl("feMergeNode", { in:"blur" }));
  feMerge.appendChild(svgEl("feMergeNode", { in:"SourceGraphic" }));
  filter.appendChild(feBlur); filter.appendChild(feMerge);
  defs.appendChild(filter);

  // Clip rect that covers only the bars area — labels drawn outside this
  const clip = svgEl("clipPath", { id:"barArea" });
  clip.appendChild(svgEl("rect", { x: padL, y: padT, width: chartW, height: chartH }));
  defs.appendChild(clip);

  svg.appendChild(defs);

  // ── Grid lines ──
  for (let i = 0; i <= ticks; i++) {
    const y   = padT + (chartH * i) / ticks;
    const val = Math.round(niceMax - (niceMax * i) / ticks);
    svg.appendChild(svgEl("line", {
      x1: padL, y1: y, x2: padL + chartW, y2: y,
      stroke: "rgba(124,58,237,0.15)", "stroke-width":"1", "stroke-dasharray":"4 6"
    }));
    const lbl = svgEl("text", {
      x: padL - 12, y: y + 4, "text-anchor":"end",
      "font-size":"11", "font-family":"Share Tech Mono, monospace",
      fill:"rgba(180,160,255,0.5)"
    });
    lbl.textContent = val >= 1000 ? (val/1000).toFixed(0)+"k" : String(val);
    svg.appendChild(lbl);
  }

  // ── Axes ──
  svg.appendChild(svgEl("line", {
    x1:padL, y1:padT, x2:padL, y2:padT+chartH,
    stroke:"rgba(124,58,237,0.4)", "stroke-width":"1.5"
  }));
  svg.appendChild(svgEl("line", {
    x1:padL, y1:padT+chartH, x2:padL+chartW, y2:padT+chartH,
    stroke:"rgba(124,58,237,0.4)", "stroke-width":"1.5"
  }));

  // ── Bars ──
  const barGap = 14;
  const barW   = (chartW - barGap * (top.length - 1)) / top.length;

  // Tooltip
  let tooltip = document.getElementById("xpTooltip");
  if (!tooltip) {
    tooltip = document.createElement("div");
    tooltip.id = "xpTooltip";
    tooltip.style.cssText = `
      position:fixed;pointer-events:none;z-index:9999;
      background:rgba(10,5,25,0.96);border:1px solid rgba(124,58,237,0.5);
      border-radius:10px;padding:9px 14px;font-family:'Share Tech Mono',monospace;
      font-size:11px;color:rgba(200,180,255,0.95);letter-spacing:0.08em;
      box-shadow:0 0 24px rgba(124,58,237,0.35);opacity:0;
      transition:opacity 0.15s ease;white-space:nowrap;
    `;
    document.body.appendChild(tooltip);
  }

  top.forEach((d, i) => {
    const fullBarH = Math.max((d.xp / niceMax) * chartH, 2);
    const x        = padL + i * (barW + barGap);
    const yFull    = padT + chartH - fullBarH;
    const barCx    = x + barW / 2;

    // ── Bar group (clipped to bar area so bars never spill) ──
    const g = svgEl("g", { style:"cursor:pointer", "clip-path":"url(#barArea)" });

    const shadow = svgEl("rect", {
      x: x+2, y: yFull+4, width: barW-4, height: fullBarH,
      rx:"7", fill:"rgba(124,58,237,0.2)", filter:"url(#glow)"
    });
    g.appendChild(shadow);

    const bar = svgEl("rect", {
      x, y: padT+chartH, width: barW, height: 0,
      rx:"7", fill:"url(#barGrad)"
    });
    g.appendChild(bar);

    const cap = svgEl("rect", {
      x: x+4, y: padT+chartH, width: barW-8, height: 3,
      rx:"2", fill:"rgba(196,181,253,0.65)", opacity:"0"
    });
    g.appendChild(cap);

    svg.appendChild(g);

    // Value label above bar — NOT clipped
    const valLbl = svgEl("text", {
      x: barCx, y: yFull - 8,
      "text-anchor":"middle", "font-size":"10",
      "font-family":"Share Tech Mono, monospace",
      fill:"rgba(210,190,255,0.85)", opacity:"0"
    });
    valLbl.textContent = formatXP(d.xp);
    svg.appendChild(valLbl);

    // ── X-axis label ──
    // text-anchor:end + rotate(-45): text extends upper-right from pivot.
    // Pivot at bar right edge makes it center visually under the bar.
    const axisY  = padT + chartH;
    const pivotX = x + barW * 0.60;  // 3/4 of bar width — centers the rotated text
    const pivotY = axisY + 15;

    // Tick at bar centre
    svg.appendChild(svgEl("line", {
      x1: barCx, y1: axisY, x2: barCx, y2: axisY + 6,
      stroke:"rgba(124,58,237,0.4)", "stroke-width":"1"
    }));

    // Shadow
    const ns = svgEl("text", {
      x: pivotX + 1, y: pivotY + 1,
      "text-anchor":"end",
      "font-size":"12", "font-weight":"700",
      "font-family":"Rajdhani, sans-serif",
      fill:"rgba(0,0,0,0.95)",
      transform:`rotate(-45 ${pivotX} ${pivotY})`
    });
    ns.textContent = d.project.length > 15 ? d.project.slice(0,14)+"…" : d.project;
    svg.appendChild(ns);

    // Bright label
    const nl = svgEl("text", {
      x: pivotX, y: pivotY,
      "text-anchor":"end",
      "font-size":"12", "font-weight":"700",
      "font-family":"Rajdhani, sans-serif",
      fill:"#f0e8ff",
      transform:`rotate(-45 ${pivotX} ${pivotY})`
    });
    nl.textContent = d.project.length > 15 ? d.project.slice(0,14)+"…" : d.project;
    svg.appendChild(nl);

    // ── Hover — hit area is the bar only ──
    const hit = svgEl("rect", {
      x, y: padT, width: barW, height: chartH,
      fill:"transparent", style:"cursor:pointer"
    });
    hit.addEventListener("mouseenter", () => {
      bar.setAttribute("fill", "url(#barGradHov)");
      bar.setAttribute("filter", "url(#glow)");
      cap.setAttribute("opacity", "0.85");
      nl.setAttribute("fill", "#ffffff");
      tooltip.style.opacity = "1";
      tooltip.innerHTML = `
        <div style="color:#c4b5fd;font-size:11px;margin-bottom:5px;letter-spacing:0.12em">${d.project.toUpperCase()}</div>
        <div style="color:#fff;font-size:13px">XP <span style="color:#a78bfa;font-weight:700">${d.xp.toLocaleString()}</span></div>
        <div style="color:rgba(255,255,255,0.4);font-size:10px;margin-top:3px">Rank #${i+1}</div>
      `;
    });
    hit.addEventListener("mousemove", e => {
      tooltip.style.left = (e.clientX + 16) + "px";
      tooltip.style.top  = (e.clientY - 12) + "px";
    });
    hit.addEventListener("mouseleave", () => {
      bar.setAttribute("fill", "url(#barGrad)");
      bar.removeAttribute("filter");
      cap.setAttribute("opacity", "0");
      nl.setAttribute("fill", "#f0e8ff");
      tooltip.style.opacity = "0";
    });
    svg.appendChild(hit);

    // ── Animate bar growth ──
    setTimeout(() => {
      const dur = 700, t0 = performance.now();
      function grow(now) {
        const t    = Math.min((now - t0) / dur, 1);
        const ease = 1 - Math.pow(1 - t, 3);
        const h    = fullBarH * ease;
        const y    = padT + chartH - h;
        bar.setAttribute("y",      y);
        bar.setAttribute("height", h);
        cap.setAttribute("y",      y);
        shadow.setAttribute("y",   y + 4);
        shadow.setAttribute("height", h);
        if (t >= 1) { valLbl.setAttribute("opacity","1"); cap.setAttribute("opacity","0.5"); }
        else requestAnimationFrame(grow);
      }
      requestAnimationFrame(grow);
    }, i * 80);
  });
}

// ─── Pass/Fail Donut

function renderPassFailChart(passFail) {
  const svg = $("passFailChart");
  if (!svg) return;
  svg.innerHTML = "";

  const pass  = Number(passFail?.pass  || 0);
  const fail  = Number(passFail?.fail  || 0);
  const total = pass + fail;

  if (!total) {
    const t = svgEl("text", { x:20, y:30, "font-size":"15", fill:"rgba(255,255,255,0.4)" });
    t.textContent = "No data";
    svg.appendChild(t);
    return;
  }

  const width  = Number(svg.getAttribute("width"))  || 260;
  const height = Number(svg.getAttribute("height")) || 300;
  const cx = width  / 2;
  const cy = (height - 40) / 2 + 10; // shift up slightly to leave room for pills

  const passPct = Math.round((pass / total) * 100);
  const failPct = 100 - passPct;

  // ── Defs ──
  const defs = svgEl("defs", {});

  // Pass gradient
  const passGrad = svgEl("linearGradient", { id:"passGrad", x1:"0", y1:"0", x2:"1", y2:"1" });
  passGrad.appendChild(svgEl("stop", { offset:"0%",   "stop-color":"#34d399" }));
  passGrad.appendChild(svgEl("stop", { offset:"100%", "stop-color":"#059669" }));
  defs.appendChild(passGrad);

  // Fail gradient
  const failGrad = svgEl("linearGradient", { id:"failGrad", x1:"0", y1:"0", x2:"1", y2:"1" });
  failGrad.appendChild(svgEl("stop", { offset:"0%",   "stop-color":"#f87171" }));
  failGrad.appendChild(svgEl("stop", { offset:"100%", "stop-color":"#b91c1c" }));
  defs.appendChild(failGrad);

  // Glow
  const glow = svgEl("filter", { id:"donutGlow" });
  glow.appendChild(svgEl("feGaussianBlur", { stdDeviation:"4", result:"blur" }));
  const fm = svgEl("feMerge", {});
  fm.appendChild(svgEl("feMergeNode", { in:"blur" }));
  fm.appendChild(svgEl("feMergeNode", { in:"SourceGraphic" }));
  glow.appendChild(fm);
  defs.appendChild(glow);

  svg.appendChild(defs);

  // ── Outer decorative ring ──
  const outerR = 118;
  for (let i = 0; i < 36; i++) {
    const angle = (i / 36) * 2 * Math.PI - Math.PI / 2;
    const dotR = i % 3 === 0 ? 2.2 : 1.1;
    const x = cx + outerR * Math.cos(angle);
    const y = cy + outerR * Math.sin(angle);
    svg.appendChild(svgEl("circle", {
      cx: x, cy: y, r: dotR,
      fill: i % 3 === 0 ? "rgba(124,58,237,0.5)" : "rgba(124,58,237,0.2)"
    }));
  }

  // ── Track ring ──
  const trackR = 88, stroke = 20;
  svg.appendChild(svgEl("circle", {
    cx, cy, r: trackR, fill:"none",
    stroke:"rgba(255,255,255,0.06)", "stroke-width": stroke
  }));

  // ── Fail arc (drawn first, behind pass) ──
  const circ    = 2 * Math.PI * trackR;
  const passLen = (pass / total) * circ;
  const failLen = circ - passLen;

  const failArc = svgEl("circle", {
    cx, cy, r: trackR, fill:"none",
    stroke: "url(#failGrad)",
    "stroke-width": stroke,
    "stroke-linecap": "round",
    "stroke-dasharray": `${failLen} ${passLen}`,
    "stroke-dashoffset": `${-(passLen - circ * 0.25)}`,
    opacity: "0.85"
  });
  svg.appendChild(failArc);

  // ── Pass arc ──
  const passArc = svgEl("circle", {
    cx, cy, r: trackR, fill:"none",
    stroke: "url(#passGrad)",
    "stroke-width": stroke,
    "stroke-linecap": "round",
    "stroke-dasharray": `${passLen} ${failLen}`,
    "stroke-dashoffset": `${circ * 0.25}`,
    filter: "url(#donutGlow)",
    opacity: "0.95"
  });
  svg.appendChild(passArc);

  // ── Animated draw: start from 0, reveal clockwise ──
  passArc.setAttribute("stroke-dasharray", `0 ${circ}`);
  failArc.setAttribute("stroke-dasharray", `0 ${circ}`);

  const duration = 1000;
  const startTime = performance.now();
  function drawArcs(now) {
    const t    = Math.min((now - startTime) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 2.5);
    const pLen = passLen * ease;
    const fLen = failLen * ease;
    passArc.setAttribute("stroke-dasharray", `${pLen} ${circ - pLen}`);
    failArc.setAttribute("stroke-dasharray", `${fLen} ${circ - fLen}`);
    if (t < 1) requestAnimationFrame(drawArcs);
    else {
      // Restore correct offset for fail
      failArc.setAttribute("stroke-dashoffset", `${-(passLen - circ * 0.25)}`);
    }
  }
  requestAnimationFrame(drawArcs);

  // ── Inner glow circle ──
  svg.appendChild(svgEl("circle", {
    cx, cy, r: trackR - stroke / 2 - 4,
    fill:"none",
    stroke:"rgba(52,211,153,0.06)",
    "stroke-width":"1"
  }));

  // ── Centre text: animated % ──
  const bigText = svgEl("text", {
    x: cx, y: cy - 8,
    "text-anchor":"middle",
    "font-size":"32",
    "font-family":"Orbitron, sans-serif",
    "font-weight":"700",
    fill:"white"
  });
  bigText.textContent = "0%";
  svg.appendChild(bigText);

  const subText = svgEl("text", {
    x: cx, y: cy + 14,
    "text-anchor":"middle",
    "font-size":"10",
    "font-family":"Share Tech Mono, monospace",
    fill:"rgba(180,255,200,0.55)",
    "letter-spacing":"0.15em"
  });
  subText.textContent = "PASS RATE";
  svg.appendChild(subText);

  // Animate the percentage counter
  const countStart = performance.now();
  function countPct(now) {
    const t    = Math.min((now - countStart) / duration, 1);
    const ease = 1 - Math.pow(1 - t, 3);
    bigText.textContent = Math.round(passPct * ease) + "%";
    if (t < 1) requestAnimationFrame(countPct);
  }
  requestAnimationFrame(countPct);
}

// ─── Audit Done / Received bars ───────────────────────────────────────────────

function renderAuditBars(audit) {
  const container = $("auditBars");
  if (!container) return;

  const done     = Number(audit?.done     || 0);
  const received = Number(audit?.received || 0);
  const maxVal   = Math.max(done, received, 1);

  const donePct = (done     / maxVal) * 100;
  const recvPct = (received / maxVal) * 100;

  container.innerHTML = `
    <div style="margin-bottom:18px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-family:'Share Tech Mono',monospace;font-size:11px;letter-spacing:0.14em;color:rgba(160,220,200,0.7);text-transform:uppercase">▲ Done</span>
        <span style="font-family:'Orbitron',sans-serif;font-size:13px;font-weight:700;color:#34d399">${formatXP(done)}</span>
      </div>
      <div style="position:relative;height:10px;background:rgba(255,255,255,0.06);border-radius:99px;overflow:hidden">
        <div id="auditDoneBar" style="
          position:absolute;top:0;left:0;height:100%;width:0%;
          background:linear-gradient(90deg,#059669,#34d399);
          border-radius:99px;
          box-shadow:0 0 12px rgba(52,211,153,0.5);
          transition:width 1.2s cubic-bezier(0.16,1,0.3,1)
        "></div>
      </div>
    </div>

    <div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-family:'Share Tech Mono',monospace;font-size:11px;letter-spacing:0.14em;color:rgba(220,160,160,0.7);text-transform:uppercase">▼ Received</span>
        <span style="font-family:'Orbitron',sans-serif;font-size:13px;font-weight:700;color:#f87171">${formatXP(received)}</span>
      </div>
      <div style="position:relative;height:10px;background:rgba(255,255,255,0.06);border-radius:99px;overflow:hidden">
        <div id="auditRecvBar" style="
          position:absolute;top:0;left:0;height:100%;width:0%;
          background:linear-gradient(90deg,#b91c1c,#f87171);
          border-radius:99px;
          box-shadow:0 0 12px rgba(248,113,113,0.4);
          transition:width 1.2s cubic-bezier(0.16,1,0.3,1)
        "></div>
      </div>
    </div>
  `;

  // Trigger CSS transition (needs two rAF to escape current paint)
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const doneBar = $("auditDoneBar");
      const recvBar = $("auditRecvBar");
      if (doneBar) doneBar.style.width = donePct + "%";
      if (recvBar) recvBar.style.width = recvPct + "%";
    });
  });
}