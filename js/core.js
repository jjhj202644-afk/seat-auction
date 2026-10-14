/* 학급 자리 경매 · 공통 엔진
   - 서버 연결(Supabase)과 체험용 서버(DemoBackend)
   - 경매 규칙 계산
   - 자리 배치 도우미 */
(function (W) {
  "use strict";
  var SA = W.SA = W.SA || {};

  /* ---------------- 작은 도우미 ---------------- */
  SA.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  SA.num = function (n) { return (n == null || isNaN(n)) ? "-" : Math.round(n).toLocaleString("ko-KR"); };
  SA.h = function (tag, attrs, html) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") el.className = attrs[k];
      else if (k.indexOf("on") === 0 && typeof attrs[k] === "function") el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null && attrs[k] !== false) el.setAttribute(k, attrs[k]);
    });
    if (html != null) el.innerHTML = html;
    return el;
  };
  SA.shuffle = function (a) {
    a = a.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  };
  SA.pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };
  SA.today = function () { var d = new Date(); return (d.getMonth() + 1) + "월 " + d.getDate() + "일"; };
  SA.todayFile = function () { var d = new Date(); return (d.getMonth() + 1) + "월" + d.getDate() + "일"; };
  SA.store = {
    get: function (k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  /* 두 번 눌러야 실행되는 버튼 */
  SA.arm = function (btn, label, fn) {
    if (btn.dataset.armed === "1") {
      clearTimeout(+btn.dataset.tid);
      btn.dataset.armed = "0"; btn.innerHTML = btn.dataset.orig; btn.classList.remove("is-armed");
      fn(); return;
    }
    btn.dataset.orig = btn.innerHTML;
    btn.dataset.armed = "1"; btn.innerHTML = label; btn.classList.add("is-armed");
    btn.dataset.tid = setTimeout(function () {
      btn.dataset.armed = "0"; btn.innerHTML = btn.dataset.orig; btn.classList.remove("is-armed");
    }, 6000);
  };

  /* 오류를 짧은 한국어로 */
  var ERR = {
    not_found: "방을 찾을 수 없어요. 방 코드를 확인하세요",
    bad_token: "다시 들어와 주세요",
    bad_pin: "교사 암호가 맞지 않아요",
    bad_seats: "자리 배치를 확인하세요",
    busy: "잠시 뒤 다시 시도하세요",
    kicked: "방에서 나왔어요",
    bad_nick: "별명은 1~10글자로 써 주세요",
    bad_no: "번호를 확인하세요",
    taken: "이미 들어온 번호예요. 같은 별명으로만 다시 들어올 수 있어요",
    closed: "경매가 시작되어 새로 들어올 수 없어요",
    bad_assets: "보유 자산을 숫자로 넣어 주세요",
    locked: "지금은 바꿀 수 없어요",
    not_bidding: "입찰 시간이 아니에요",
    too_late: "입찰 시간이 끝났어요",
    bad_bids: "입찰 내용을 확인하세요",
    too_many: "입찰 가능 자리보다 많아요",
    too_low: "시작가보다 낮아요",
    seat_taken: "고를 수 없는 자리가 있어요",
    over_budget: "입찰 가능 금액을 넘었어요",
    not_owner: "내 자리가 아니에요",
    bad_rent: "임대료를 숫자로 넣어 주세요",
    network: "인터넷 연결을 확인하세요",
    setup: "서버 준비가 안 되어 있어요 (설치 안내를 확인하세요)"
  };
  SA.errText = function (e) {
    var k = (e && e.code) || "";
    return ERR[k] || ("문제가 생겼어요" + (e && e.message ? " (" + e.message + ")" : ""));
  };
  function fail(code, msg) { var e = new Error(msg || code); e.code = code; throw e; }
  SA.fail = fail;

  /* ---------------- 규칙 ---------------- */
  // 한 학생이 이번 차수에 입찰할 수 있는 자리 수 (-1 = 제한 없음)
  SA.allowed = function (settings, seats, no) {
    var mx = +(settings.maxSeats || 0);
    if (mx <= 0) return -1;
    var owned = 0, presat = false;
    seats.forEach(function (s) {
      if (s.owner === no) owned++;
      if (s.gov && s.sitter === no) presat = true;
    });
    if (mx === 1 && presat) return 0;
    return Math.max(mx - owned, 0);
  };
  SA.isOpenSeat = function (s) { return !s.gov && s.owner == null && !s.tie; };

  // 마감된 차수의 입찰을 자리마다 계산
  SA.resolve = function (seats, bids) {
    var open = {}; seats.forEach(function (s) { if (SA.isOpenSeat(s)) open[s.no] = true; });
    var by = {};
    bids.forEach(function (b) { if (open[b.seat]) (by[b.seat] = by[b.seat] || []).push(b); });
    var wins = [], ties = [], unsold = [];
    Object.keys(open).forEach(function (k) {
      var list = by[k] || [];
      if (!list.length) { unsold.push(+k); return; }
      var max = Math.max.apply(null, list.map(function (b) { return b.amount; }));
      var top = list.filter(function (b) { return b.amount === max; }).map(function (b) { return b.no; });
      if (top.length === 1) wins.push({ seat: +k, no: top[0], amount: max });
      else ties.push({ seat: +k, amount: max, cands: top.sort(function (a, b) { return a - b; }) });
    });
    return { wins: wins, ties: ties, unsold: unsold };
  };

  // 경매를 더 이어갈 수 있는지
  SA.endReason = function (st) {
    var S = st.room.settings, seats = st.seats;
    var open = seats.filter(SA.isOpenSeat).length;
    if (open === 0) return "모든 자리 낙찰";
    var sp = +(S.startPrice || 0);
    var any = st.students.some(function (p) {
      var a = SA.allowed(S, seats, p.no);
      return a !== 0 && (p.assets || 0) >= sp;
    });
    if (!any) return "더 입찰할 학생 없음";
    return "";
  };

  /* ---------------- 자리 배치 ---------------- */
  // cells: "S"(자리) "E"(빈칸) "G"(국유지) 를 줄 우선으로 담은 배열
  SA.templates = {
    line:  { name: "한 줄씩" },
    pair:  { name: "짝" },
    g4:    { name: "모둠 4인" },
    g6:    { name: "모둠 6인" },
    u:     { name: "ㄷ자" },
    mine:  { name: "직접" }
  };
  SA.makeTemplate = function (kind, n) {
    n = Math.max(1, n | 0);
    var rows, cols, cells = [], i;
    function grid(r, c) { rows = r; cols = c; cells = []; for (i = 0; i < r * c; i++) cells.push("E"); }
    function set(r, c, v) { cells[r * cols + c] = v; }
    var placed = 0;
    if (kind === "pair") {
      var perRow = 6; grid(Math.ceil(n / perRow), 8);
      for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
        if (c === 2 || c === 5) continue;
        if (placed < n) { set(r, c, "S"); placed++; }
      }
    } else if (kind === "g4" || kind === "g6") {
      var gw = kind === "g4" ? 2 : 3, gh = 2, per = gw * gh;
      var gpr = kind === "g4" ? 3 : 2;
      var groups = Math.ceil(n / per); gpr = Math.min(gpr, groups);
      var grows = Math.ceil(groups / gpr);
      grid(grows * (gh + 1) - 1, gpr * (gw + 1) - 1);
      for (var g = 0; g < groups; g++) {
        var gr = Math.floor(g / gpr), gc = g % gpr;
        for (var y = 0; y < gh; y++) for (var x = 0; x < gw; x++) {
          if (placed < n) { set(gr * (gh + 1) + y, gc * (gw + 1) + x, "S"); placed++; }
        }
      }
    } else if (kind === "u") {
      var cc = 8, rr = Math.max(3, Math.ceil((n - (cc - 2)) / 2) + 1);
      if (2 * rr + (cc - 2) < n) rr = Math.ceil((n - (cc - 2)) / 2);
      grid(rr, cc);
      // 뒷줄(맨 위) → 양옆
      for (var a = 0; a < cc && placed < n; a++) { set(0, a, "S"); placed++; }
      for (var b = 1; b < rr && placed < n; b++) {
        set(b, 0, "S"); placed++;
        if (placed < n) { set(b, cc - 1, "S"); placed++; }
      }
    } else {
      var w = n <= 12 ? 4 : 6; grid(Math.ceil(n / w), w);
      for (i = 0; i < n; i++) cells[i] = "S";
    }
    return { rows: rows, cols: cols, cells: cells };
  };

  // 자동 번호: corner = tl|tr|bl|br, dir = row|col
  SA.autoNumber = function (rows, cols, cells, corner, dir) {
    var nums = cells.map(function () { return null; });
    var rOrder = [], cOrder = [], i, k = 1;
    for (i = 0; i < rows; i++) rOrder.push(corner[0] === "b" ? rows - 1 - i : i);
    for (i = 0; i < cols; i++) cOrder.push(corner[1] === "r" ? cols - 1 - i : i);
    if (dir === "col") {
      cOrder.forEach(function (c) { rOrder.forEach(function (r) { var ix = r * cols + c; if (cells[ix] !== "E") nums[ix] = k++; }); });
    } else {
      rOrder.forEach(function (r) { cOrder.forEach(function (c) { var ix = r * cols + c; if (cells[ix] !== "E") nums[ix] = k++; }); });
    }
    return nums;
  };

  // 설정 → 서버로 보낼 자리 목록
  SA.seatsFromSettings = function (S) {
    var out = [], pre = S.presat || {};
    S.cells.forEach(function (t, ix) {
      if (t === "E") return;
      var no = S.nums[ix];
      out.push({ no: no, r: Math.floor(ix / S.cols), c: ix % S.cols, gov: t === "G",
                 sitter: (t === "G" && pre[no]) ? +pre[no] : null });
    });
    return out;
  };

  SA.checkLayout = function (S) {
    var seen = {}, dup = false, cnt = 0, gov = 0;
    S.cells.forEach(function (t, ix) {
      if (t === "E") return;
      cnt++; if (t === "G") gov++;
      var n = S.nums[ix];
      if (!n || seen[n]) dup = true; seen[n] = true;
    });
    return { seats: cnt, gov: gov, auction: cnt - gov, dupNumbers: dup };
  };

  SA.defaultSettings = function () {
    var t = SA.makeTemplate("line", 26);
    return {
      v: 1, unit: "패티", govName: "국유지", studentCount: 26,
      rows: t.rows, cols: t.cols, cells: t.cells, deskPos: "bottom", corner: "br", dir: "row",
      nums: SA.autoNumber(t.rows, t.cols, t.cells, "br", "row"),
      presat: {}, startPrice: 0, maxSeats: 1, tieMode: "auto", timer: 120, nonPart: "random"
    };
  };

  /* ---------------- 서버: Supabase ---------------- */
  function SupabaseBackend(cfg) {
    this.url = String(cfg.url || "").trim().replace(/\/+$/, "").replace(/\/rest\/v1$/i, "");
    this.key = String(cfg.key || "").trim();
    this.kind = "server";
  }
  SupabaseBackend.prototype.ready = function () { return !!(this.url && this.key); };
  SupabaseBackend.prototype.rpc = function (fn, args) {
    var self = this;
    if (!this.ready()) return Promise.reject(Object.assign(new Error("setup"), { code: "setup" }));
    var h = { apikey: this.key, "Content-Type": "application/json" };
    if (this.key.indexOf("sb_") !== 0) h.Authorization = "Bearer " + this.key;
    return fetch(self.url + "/rest/v1/rpc/" + fn, { method: "POST", headers: h, body: JSON.stringify(args || {}), cache: "no-store" })
      .then(function (r) {
        return r.text().then(function (t) {
          var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {}
          if (!r.ok) {
            var m = (j && j.message) || t || ("HTTP " + r.status);
            var code = /^[a-z_]+$/.test(m) ? m : ((j && j.code === "PGRST202") || r.status === 404 ? "setup" : "server");
            var err = new Error(m); err.code = code; throw err;
          }
          return j;
        });
      }, function () { var e = new Error("network"); e.code = "network"; throw e; });
  };
  var P = SupabaseBackend.prototype;
  P.tCreate = function (pin, settings, seats) { return this.rpc("auc_t_create", { p_pin: pin, p_settings: settings, p_seats: seats }); };
  P.tLogin  = function (code, pin) { return this.rpc("auc_t_login", { p_code: code, p_pin: pin }); };
  P.tState  = function (code, tok) { return this.rpc("auc_t_state", { p_code: code, p_token: tok }); };
  P.tSave   = function (code, tok, room, students, seats) {
    return this.rpc("auc_t_save", { p_code: code, p_token: tok, p_room: room || {}, p_students: students || [], p_seats: seats || [] });
  };
  P.tDelete = function (code, tok) { return this.rpc("auc_t_delete", { p_code: code, p_token: tok }); };
  P.sJoin   = function (code, no, nick, assets) { return this.rpc("auc_s_join", { p_code: code, p_no: no, p_nick: nick, p_assets: assets }); };
  P.sState  = function (code, no, tok) { return this.rpc("auc_s_state", { p_code: code, p_no: no, p_token: tok }); };
  P.sAssets = function (code, no, tok, a) { return this.rpc("auc_s_assets", { p_code: code, p_no: no, p_token: tok, p_assets: a }); };
  P.sBid    = function (code, no, tok, bids) { return this.rpc("auc_s_bid", { p_code: code, p_no: no, p_token: tok, p_bids: bids }); };
  P.sPick   = function (code, no, tok, seat) { return this.rpc("auc_s_pick", { p_code: code, p_no: no, p_token: tok, p_seat: seat }); };
  P.sRent   = function (code, no, tok, seat, rent) { return this.rpc("auc_s_rent", { p_code: code, p_no: no, p_token: tok, p_seat: seat, p_rent: rent }); };
  SA.SupabaseBackend = SupabaseBackend;

  /* ---------------- 서버: 체험용 (브라우저 안에서만) ---------------- */
  function DemoBackend() {
    this.kind = "demo"; this.rooms = {}; this.listeners = [];
  }
  var D = DemoBackend.prototype;
  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function iso(t) { return t == null ? null : new Date(t).toISOString(); }
  function uid() { return "d" + Math.random().toString(36).slice(2) + Date.now().toString(36); }
  D._room = function (code, tok) {
    var R = this.rooms[code]; if (!R) fail("not_found");
    if (R.tok !== tok) fail("bad_token"); return R;
  };
  D._stud = function (code, no, tok) {
    var R = this.rooms[code]; if (!R) fail("not_found");
    var s = R.students[no]; if (!s || s.token !== tok) fail("kicked"); return { R: R, s: s };
  };
  D._wrap = function (fn) {
    var self = this;
    return new Promise(function (res, rej) {
      setTimeout(function () { try { res(clone(fn.call(self))); } catch (e) { rej(e); } }, 15);
    });
  };
  D._seatsArr = function (R) { return Object.keys(R.seats).map(function (k) { return R.seats[k]; }).sort(function (a, b) { return a.no - b.no; }); };
  D._tState = function (R) {
    var self = this;
    return {
      now: iso(Date.now()),
      room: { code: R.code, settings: R.settings, phase: R.phase, round: R.round, deadline: iso(R.deadline),
              reveal_at: iso(R.reveal_at), meta: R.meta, created_at: iso(R.created), expires_at: iso(R.created + 864e5) },
      students: Object.keys(R.students).map(function (k) { var s = R.students[k]; return { no: s.no, nick: s.nick, assets: s.assets, bid_any: s.bid_any }; })
        .sort(function (a, b) { return a.no - b.no; }),
      seats: self._seatsArr(R),
      bids: R.bids.filter(function (b) { return b.round === R.round; }).map(function (b) { return { no: b.no, seat: b.seat, amount: b.amount, at: iso(b.at) }; })
    };
  };
  D.tCreate = function (pin, settings, seats) {
    return this._wrap(function () {
      if (!pin || String(pin).trim().length < 4) fail("bad_pin");
      var code; do { code = String(100000 + Math.floor(Math.random() * 900000)); } while (this.rooms[code]);
      var R = { code: code, pin: String(pin).trim(), tok: uid(), settings: clone(settings), phase: "lobby", round: 0,
                deadline: null, reveal_at: null, meta: {}, created: Date.now(), students: {}, seats: {}, bids: [] };
      seats.forEach(function (s) {
        R.seats[s.no] = { no: s.no, r: s.r, c: s.c, gov: !!s.gov, owner: null, price: null, won_round: null,
                          tie: null, tied: null, sitter: s.sitter || null, rent: null };
      });
      this.rooms[code] = R;
      return { code: code, token: R.tok };
    });
  };
  D.tLogin = function (code, pin) {
    return this._wrap(function () {
      var R = this.rooms[code]; if (!R) fail("not_found");
      if (String(pin).trim() !== R.pin) fail("bad_pin");
      return { code: code, token: R.tok };
    });
  };
  D.tState = function (code, tok) { return this._wrap(function () { return this._tState(this._room(code, tok)); }); };
  D.tSave = function (code, tok, room, students, seats) {
    return this._wrap(function () {
      var R = this._room(code, tok); room = room || {};
      ["phase", "round", "meta", "settings"].forEach(function (k) { if (k in room) R[k] = clone(room[k]); });
      if ("reveal_in" in room) R.reveal_at = room.reveal_in == null ? null : Date.now() + room.reveal_in * 1000;
      if ("deadline_in" in room) R.deadline = room.deadline_in == null ? null : Date.now() + room.deadline_in * 1000;
      else if ("deadline_add" in room) R.deadline = Math.max(R.deadline || Date.now(), Date.now()) + room.deadline_add * 1000;
      (students || []).forEach(function (e) {
        if (e.remove) { delete R.students[e.no]; R.bids = R.bids.filter(function (b) { return b.no !== e.no; }); }
        else if (R.students[e.no] && "assets" in e) R.students[e.no].assets = e.assets;
      });
      (seats || []).forEach(function (e) {
        var s = R.seats[e.no]; if (!s) return;
        ["gov", "owner", "price", "won_round", "tie", "tied", "sitter", "rent"].forEach(function (k) { if (k in e) s[k] = clone(e[k]); });
        if (s.gov == null) s.gov = false;
      });
      return this._tState(R);
    });
  };
  D.tDelete = function (code, tok) { return this._wrap(function () { this._room(code, tok); delete this.rooms[code]; return { ok: true }; }); };
  D.sJoin = function (code, no, nick, assets) {
    return this._wrap(function () {
      var R = this.rooms[code]; if (!R) fail("not_found");
      var n = String(nick || "").trim(); if (n.length < 1 || n.length > 10) fail("bad_nick");
      no = +no; if (!no || no < 1 || no > +R.settings.studentCount) fail("bad_no");
      var s = R.students[no];
      if (s) {
        if (s.nick.toLowerCase() !== n.toLowerCase()) fail("taken");
        if (R.phase === "lobby" && assets != null && assets >= 0) s.assets = +assets;
        return { token: s.token, rejoin: true };
      }
      if (R.phase !== "lobby") fail("closed");
      if (assets == null || isNaN(assets) || assets < 0) fail("bad_assets");
      s = R.students[no] = { no: no, nick: n, token: uid(), assets: +assets, bid_any: false };
      return { token: s.token, rejoin: false };
    });
  };
  D.sState = function (code, no, tok) {
    return this._wrap(function () {
      var x = this._stud(code, no, tok), R = x.R, s = x.s, self = this;
      var nick = function (n) { return n != null && R.students[n] ? R.students[n].nick : null; };
      var S = R.settings, nicks = {};
      Object.keys(R.students).forEach(function (k) { nicks[k] = R.students[k].nick; });
      var seats = self._seatsArr(R);
      return {
        now: iso(Date.now()),
        room: { code: R.code, phase: R.phase, round: R.round, deadline: iso(R.deadline), reveal_at: iso(R.reveal_at),
                settings: { unit: S.unit, govName: S.govName, studentCount: S.studentCount, rows: S.rows, cols: S.cols,
                            deskPos: S.deskPos, startPrice: S.startPrice, maxSeats: S.maxSeats, timer: S.timer, tieMode: S.tieMode } },
        me: { no: s.no, nick: s.nick, assets: s.assets, allowed: SA.allowed(S, seats, s.no) },
        seats: seats.map(function (z) { var o = clone(z); o.owner_nick = nick(z.owner); o.sitter_nick = nick(z.sitter); return o; }),
        nicks: nicks,
        mybids: R.bids.filter(function (b) { return b.round === R.round && b.no === s.no; })
          .map(function (b) { return { seat: b.seat, amount: b.amount }; }).sort(function (a, b) { return a.seat - b.seat; })
      };
    });
  };
  D.sAssets = function (code, no, tok, a) {
    return this._wrap(function () {
      var x = this._stud(code, no, tok); if (x.R.phase !== "lobby") fail("locked");
      if (a == null || isNaN(a) || a < 0) fail("bad_assets"); x.s.assets = +a; return { ok: true };
    });
  };
  D.sBid = function (code, no, tok, bids) {
    return this._wrap(function () {
      var x = this._stud(code, no, tok), R = x.R, s = x.s;
      if (R.phase !== "bidding") fail("not_bidding");
      if (R.deadline && Date.now() > R.deadline + 1000) fail("too_late");
      if (!Array.isArray(bids)) fail("bad_bids");
      var seats = this._seatsArr(R), allowed = SA.allowed(R.settings, seats, s.no);
      if (allowed >= 0 && bids.length > allowed) fail("too_many");
      var sp = +(R.settings.startPrice || 0), total = 0, seen = {};
      bids.forEach(function (b) {
        if (b.seat == null || b.amount == null || seen[b.seat]) fail("bad_bids"); seen[b.seat] = 1;
        if (b.amount < sp) fail("too_low");
        var z = R.seats[b.seat]; if (!z || !SA.isOpenSeat(z)) fail("seat_taken");
        total += +b.amount;
      });
      if (total > (s.assets || 0)) fail("over_budget");
      R.bids = R.bids.filter(function (b) { return !(b.round === R.round && b.no === s.no); });
      bids.forEach(function (b) { R.bids.push({ round: R.round, no: s.no, seat: +b.seat, amount: +b.amount, at: Date.now() }); });
      if (bids.length) s.bid_any = true;
      return { ok: true, count: bids.length, total: total };
    });
  };
  D.sPick = function (code, no, tok, seat) {
    return this._wrap(function () {
      var x = this._stud(code, no, tok), R = x.R; if (R.phase !== "seatpick") fail("locked");
      var z = R.seats[seat]; if (!z || z.owner !== x.s.no) fail("not_owner");
      Object.keys(R.seats).forEach(function (k) { var q = R.seats[k]; if (q.owner === x.s.no && q.sitter === x.s.no) q.sitter = null; });
      z.sitter = x.s.no; return { ok: true };
    });
  };
  D.sRent = function (code, no, tok, seat, rent) {
    return this._wrap(function () {
      var x = this._stud(code, no, tok), R = x.R; if (R.phase !== "rent") fail("locked");
      if (rent == null || isNaN(rent) || rent < 0) fail("bad_rent");
      var z = R.seats[seat]; if (!z || z.owner !== x.s.no || z.sitter === x.s.no || (z.sitter != null && z.rent != null)) fail("locked");
      z.rent = +rent; return { ok: true };
    });
  };
  SA.DemoBackend = DemoBackend;

  /* 체험용 가상 학생들 */
  SA.DEMO_NICKS = ["바다", "하늘", "숲", "구름", "별", "해", "달", "바람", "솔", "이슬", "노을", "단비", "새싹",
    "보라", "초롱", "가람", "한결", "다온", "라온", "누리", "하랑", "봄", "여름", "가을", "겨울"];
  SA.startBots = function (backend, code, count) {
    var bots = [], timers = [];
    function later(ms, fn) { timers.push(setTimeout(fn, ms)); }
    for (var i = 1; i <= count; i++) (function (no) {
      later(400 + no * 220, function () {
        var assets = Math.round((50 + Math.random() * 950) / 10) * 10;
        backend.sJoin(code, no, SA.DEMO_NICKS[(no - 1) % SA.DEMO_NICKS.length], assets).then(function (r) {
          bots.push({ no: no, tok: r.token, lastRound: 0, picked: false, rented: {} });
        }).catch(function () {});
      });
    })(i);
    var tick = setInterval(function () {
      var R = backend.rooms[code]; if (!R) { clearInterval(tick); timers.forEach(clearTimeout); return; }
      bots.forEach(function (b) {
        if (b.busy) return;
        if (R.phase === "bidding" && b.lastRound !== R.round) {
          b.lastRound = R.round; b.busy = true;
          var wait = 1500 + Math.random() * 6000;
          later(wait, function () {
            backend.sState(code, b.no, b.tok).then(function (st) {
              var open = st.seats.filter(SA.isOpenSeat);
              var allowed = st.me.allowed, cash = st.me.assets || 0, sp = +(st.room.settings.startPrice || 0);
              if (!open.length || allowed === 0 || cash < sp || Math.random() < 0.12) return null;
              var k = allowed < 0 ? Math.min(3, open.length) : Math.min(allowed, open.length);
              k = Math.max(1, Math.ceil(Math.random() * k));
              var picks = SA.shuffle(open).slice(0, k), left = cash, bids = [];
              picks.forEach(function (z, ix) {
                var share = ix === picks.length - 1 ? left : Math.floor(left * (0.3 + Math.random() * 0.5));
                var amt = Math.max(sp, Math.round(share * (0.4 + Math.random() * 0.6) / 10) * 10);
                if (amt > left) amt = left;
                if (amt < sp) return;
                bids.push({ seat: z.no, amount: amt }); left -= amt;
              });
              return bids.length ? backend.sBid(code, b.no, b.tok, bids) : null;
            }).catch(function () {}).then(function () { b.busy = false; });
          });
        } else if (R.phase === "seatpick" && !b.picked) {
          b.picked = true;
          later(800 + Math.random() * 2500, function () {
            var mine = Object.keys(R.seats).map(function (k) { return R.seats[k]; }).filter(function (z) { return z.owner === b.no; });
            if (mine.length > 1) backend.sPick(code, b.no, b.tok, SA.pick(mine).no).catch(function () {});
          });
        } else if (R.phase === "rent") {
          Object.keys(R.seats).forEach(function (k) {
            var z = R.seats[k];
            if (z.owner === b.no && z.sitter !== b.no && z.rent == null && !b.rented[z.no]) {
              b.rented[z.no] = true;
              later(1000 + Math.random() * 3000, function () {
                backend.sRent(code, b.no, b.tok, z.no, Math.round(Math.random() * 10) * 10).catch(function () {});
              });
            }
          });
        }
      });
    }, 500);
    return function stop() { clearInterval(tick); timers.forEach(clearTimeout); };
  };

  /* 서버 시각 맞추기 */
  SA.Clock = function () { this.off = 0; };
  SA.Clock.prototype.sync = function (serverIso) { if (serverIso) this.off = new Date(serverIso).getTime() - Date.now(); };
  SA.Clock.prototype.now = function () { return Date.now() + this.off; };
  SA.Clock.prototype.left = function (iso) { return iso ? Math.max(0, new Date(iso).getTime() - this.now()) : null; };
  SA.mmss = function (ms) {
    var s = Math.ceil(ms / 1000), m = Math.floor(s / 60); s = s % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  };

  /* 내려받기 */
  SA.download = function (name, text, type) {
    var blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
    var a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  SA.csv = function (rows) {
    return "﻿" + rows.map(function (r) {
      return r.map(function (v) { v = v == null ? "" : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",");
    }).join("\r\n");
  };

  /* 학생용 주소 */
  SA.studentUrl = function (code) {
    var base = location.href.split("#")[0].split("?")[0].replace(/[^\/]*$/, "");
    return base + "student.html?room=" + code;
  };
})(window);
