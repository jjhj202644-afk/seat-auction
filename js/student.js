/* 학급 자리 경매 · 학생 화면 */
(function (W) {
  "use strict";
  var SA = W.SA, esc = SA.esc, num = SA.num;
  var LKEY = "sa-student", POLL = 1500;

  function StudentApp(root, backend, opts) {
    this.root = root; this.be = backend; this.opts = opts || {};
    this.clock = new SA.Clock();
    this.st = null; this.sess = null;
    this.draft = []; this.sel = null; this.editing = false; this.round = 0;
    this.lastKey = "";
    var self = this;
    this._tick = setInterval(function () { self.tick(); }, 250);
  }
  var P = StudentApp.prototype;
  SA.StudentApp = StudentApp;

  P.toast = function (msg) {
    var host = this.opts.demo ? this.root : document.body;
    var t = SA.h("div", { class: "toast" }, esc(msg));
    if (this.opts.demo) t.style.position = "absolute";
    host.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  };

  /* ---------------- 들어오기 ---------------- */
  P.boot = function () {
    var self = this, want = this.opts.code || "";
    var s = this.opts.demo ? null : SA.store.get(LKEY);
    if (s && s.code && s.token && (!want || want === s.code)) {
      this.be.sState(s.code, s.no, s.token).then(function (st) { self.enter(s, st); })
        .catch(function () { SA.store.del(LKEY); self.renderJoin(want); });
    } else this.renderJoin(want);
  };

  P.renderJoin = function (code, msg) {
    var self = this; this.stopPoll(); this.sess = null; this.st = null; this.lastKey = "";
    var o = this.opts;
    this.root.innerHTML =
      '<div class="join"><h1>자리 경매</h1><p class="lead">방 코드와 번호를 넣고 들어가요</p>' +
      '<form autocomplete="off">' +
        '<label class="field">방 코드<input class="input" name="code" inputmode="numeric" maxlength="6" value="' + esc(code || "") + '"' + (o.demo ? " readonly" : "") + '></label>' +
        '<label class="field">번호<input class="input" name="no" inputmode="numeric" maxlength="2" value="' + esc(o.presetNo || "") + '"></label>' +
        '<label class="field">이름(별명 가능)<input class="input" name="nick" maxlength="10" value="' + esc(o.presetNick || "") + '">' +
          '<small>실명 대신 별명을 권장합니다 · 다시 들어올 때는 같은 번호·이름</small></label>' +
        '<label class="field">보유 자산<input class="input" name="assets" inputmode="numeric" maxlength="9" value="' + esc(o.presetAssets || "") + '">' +
          '<small>지금 가진 돈 · 경매 시작 전까지 고칠 수 있어요</small></label>' +
        '<button class="btn lg pri">들어가기</button><div class="err">' + esc(msg || "") + '</div>' +
      '</form></div>';
    var f = this.root.querySelector("form");
    if (!code) f.code.focus(); else if (!f.no.value) f.no.focus();
    f.onsubmit = function (ev) {
      ev.preventDefault();
      var out = f.querySelector(".err"), c = f.code.value.trim(), no = parseInt(f.no.value, 10), nick = f.nick.value.trim();
      var av = f.assets.value.replace(/[,\s]/g, ""), a = av === "" ? null : Math.round(+av);
      if (!/^\d{6}$/.test(c)) { out.textContent = "방 코드 6자리를 넣어 주세요"; return; }
      if (!no) { out.textContent = "번호를 넣어 주세요"; return; }
      if (!nick) { out.textContent = "이름(별명)을 넣어 주세요"; return; }
      if (a != null && (isNaN(a) || a < 0)) { out.textContent = "보유 자산을 숫자로 넣어 주세요"; return; }
      out.textContent = "들어가는 중…";
      self.be.sJoin(c, no, nick, a).then(function (r) {
        var sess = { code: c, no: no, token: r.token, nick: nick };
        return self.be.sState(c, no, r.token).then(function (st) { self.enter(sess, st); });
      }).catch(function (e) {
        out.textContent = e.code === "bad_assets" && a == null ? "보유 자산을 넣어 주세요" : SA.errText(e);
      });
    };
  };

  P.enter = function (sess, st) {
    this.sess = sess;
    if (!this.opts.demo) SA.store.set(LKEY, sess);
    this.root.innerHTML = '<div class="st"><div class="st-head" data-head></div><div data-dash></div><div data-body></div></div>';
    this.lastKey = ""; this.lastHead = ""; this.lastDash = "";
    this.setState(st); this.startPoll();
  };
  P.startPoll = function () {
    var self = this; this.stopPoll();
    this._poll = setInterval(function () { self.refresh(); }, POLL);
  };
  P.stopPoll = function () { clearInterval(this._poll); this._poll = null; };
  P.refresh = function () {
    var self = this; if (!this.sess || this.busy) return Promise.resolve();
    return this.be.sState(this.sess.code, this.sess.no, this.sess.token).then(function (st) { if (!self.busy) self.setState(st); })
      .catch(function (e) {
        if (e.code === "kicked") self.out("방에서 나왔어요", "같은 번호·이름으로 다시 들어올 수 있어요");
        else if (e.code === "not_found") self.out("경매가 끝났어요", "");
      });
  };
  P.out = function (title, sub) {
    this.stopPoll(); SA.store.del(LKEY);
    var self = this, code = this.sess ? this.sess.code : "";
    this.sess = null; this.st = null;
    this.root.innerHTML = '<div class="join"><div class="st-wait"><div class="st-big">' + esc(title) + '</div>' +
      (sub ? '<p class="st-mid">' + esc(sub) + '</p>' : "") + '</div>' +
      '<button class="btn lg" style="width:100%" data-again>처음으로</button></div>';
    this.root.querySelector("[data-again]").onclick = function () { self.renderJoin(code); };
  };

  /* ---------------- 상태 ---------------- */
  P.setState = function (st) {
    var prev = this.st; this.st = st; this.clock.sync(st.now);
    var r = st.room;
    if (r.phase === "bidding" && (this.round !== r.round || !prev || prev.room.phase !== "bidding")) {
      // 새 차수: 초안은 비우고, 이미 낸 입찰이 있으면 그것을 보여 줌
      this.round = r.round; this.editing = false; this.sel = null;
      this.draft = st.mybids.map(function (b) { return { seat: b.seat, amount: b.amount }; });
    }
    if (r.phase !== "bidding") { this.editing = false; }
    this.render();
  };

  P.S = function () { return this.st.room.settings; };
  P.unit = function () { return esc(this.S().unit || ""); };
  P.me = function () { return this.st.me; };
  P.seatMap = function () { var m = {}; this.st.seats.forEach(function (s) { m[s.no] = s; }); return m; };
  P.submitted = function () { return this.st.mybids.length > 0; };
  P.locked = function () { // 입력을 막아야 하는지
    var r = this.st.room;
    if (r.phase !== "bidding") return true;
    if (r.deadline && this.clock.left(r.deadline) <= 0) return true;
    return this.submitted() && !this.editing;
  };
  P.total = function () { return this.draft.reduce(function (a, b) { return a + (+b.amount || 0); }, 0); };
  P.mySeats = function () { var me = this.me().no; return this.st.seats.filter(function (s) { return s.owner === me; }); };
  P.mySit = function () { var me = this.me().no; return this.st.seats.filter(function (s) { return s.sitter === me; })[0]; };

  /* ---------------- 그리기 ---------------- */
  P.statusText = function () {
    var r = this.st.room;
    return { lobby: "대기", bidding: r.round + "차 입찰", closed: r.round + "차 마감", revealed: r.round + "차 결과",
             ending: "경매 종료", seatpick: "자리 고르기", rent: "임대", done: "끝" }[r.phase] || "";
  };

  P.render = function () {
    if (!this.st || !this.sess) return;
    var q = this.root.querySelector.bind(this.root);
    var me = this.me(), r = this.st.room;
    var head = '<div class="st-me">' + me.no + '번 ' + esc(me.nick) + '</div>' +
      '<div class="st-status' + (r.phase === "bidding" ? " on" : "") + '">' + esc(this.statusText()) + '</div>';
    if (head !== this.lastHead) { q("[data-head]").innerHTML = head; this.lastHead = head; }
    var key = JSON.stringify([r.phase, r.round, !!(r.reveal_at && this.clock.left(r.reveal_at) > 0), this.st.seats, this.st.mybids, me,
      this.editing, this.draft.map(function (d) { return d.seat; }), this.sel, this.locked(), this.rentEdit || null]);
    if (key !== this.lastKey) {
      var body = q("[data-body]");
      // 입력 중인 칸은 지키기 (차수·단계가 바뀌면 다시 그림)
      var ae = document.activeElement, keep = ae && body.contains(ae) && ae.tagName === "INPUT" ? ae.dataset.keep : null;
      var stage = r.phase + r.round + this.locked();
      if (keep && stage === this._lastStage) { this.dash(); return; }
      this.lastKey = key; this._lastStage = stage;
      body.innerHTML = this.bodyHTML();
      this.bindBody();
      this.fitMap();
    }
    this.dash();
  };

  /* 맨 위 숫자판 */
  P.dash = function () {
    var r = this.st.room, me = this.me(), u = this.unit(), items = [];
    var el = this.root.querySelector("[data-dash]"); if (!el) return;
    if (r.phase === "bidding") {
      var t = this.total(), avail = (me.assets || 0) - t;
      var al = me.allowed, left = al < 0 ? null : al - this.draft.length;
      items.push(["보유 자산", num(me.assets)]);
      items.push(["입찰 금액", num(t)]);
      items.push(["입찰 가능 금액", num(avail), avail < 0 || this._over ? "over" : ""]);
      items.push(["입찰 가능 자리", left == null ? "제한 없음" : String(left), left != null && left < 0 ? "over" : ""]);
      if (r.deadline) items.push(["남은 시간", '<span data-t>' + SA.mmss(this.clock.left(r.deadline)) + '</span>', "timer"]);
    } else if (r.phase === "closed" || r.phase === "revealed") {
      items.push(["보유 자산", num(me.assets)]);
      var mine = this.mySeats();
      items.push(["낙찰 자리", mine.length ? mine.map(function (s) { return s.no; }).join(", ") : "-"]);
    }
    var html = items.length ? '<div class="dash" style="--dc:' + items.length + '">' + items.map(function (it) {
      return '<div class="' + (it[2] || "") + '"><div class="k">' + it[0] + '</div><div class="v' + (it[0] === "입찰 가능 자리" && it[1] === "제한 없음" ? " sm" : "") + '">' + it[1] + '</div></div>';
    }).join("") + '</div>' : "";
    if (html !== this.lastDash) { el.innerHTML = html; this.lastDash = html; }
    this.tick();
  };

  P.tick = function () {
    if (!this.st || !this.sess) return;
    var r = this.st.room;
    if (r.phase === "bidding" && r.deadline) {
      var left = this.clock.left(r.deadline), t = this.root.querySelector("[data-t]");
      if (t) { t.textContent = SA.mmss(left); t.closest(".timer").classList.toggle("hot", left <= 10000); }
      if (left <= 0 && !this._lockedShown) { this._lockedShown = true; this.lastKey = ""; this.render(); }
      if (left > 0) this._lockedShown = false;
    }
    var cd = this.root.querySelector("[data-cd]");
    if (r.phase === "revealed" && r.reveal_at) {
      var ms = this.clock.left(r.reveal_at);
      if (ms > 0 && cd) cd.textContent = Math.ceil(ms / 1000);
      if (ms <= 0 && cd) { this.lastKey = ""; this.render(); }
    }
  };

  /* 작은 자리표 */
  P.mapHTML = function (cls) {
    var S = this.S(), cols = S.cols, rows = S.rows, at = {};
    this.st.seats.forEach(function (s) { at[s.r * cols + s.c] = s; });
    var cells = "";
    for (var i = 0; i < rows * cols; i++) cells += at[i] ? this.sseat(at[i], cls) : '<div class="sseat gap"></div>';
    var desk = '<div class="sdesk">교탁</div>';
    return '<div class="smap" data-smap>' + (S.deskPos === "top" ? desk : "") +
      '<div class="smap-grid" style="grid-template-columns:repeat(' + cols + ',var(--sc,52px))">' + cells + '</div>' +
      (S.deskPos !== "top" ? desk : "") + '</div>';
  };
  P.sseat = function (s, mode) {
    var me = this.me().no, S = this.S(), gn = esc(S.govName || "국유지");
    var c = "sseat", sub = "";
    if (mode === "bid") {
      var inDraft = this.draft.some(function (d) { return d.seat === s.no; });
      var sent = this.st.mybids.some(function (b) { return b.seat === s.no; });
      if (!SA.isOpenSeat(s)) { c += s.gov ? " gov" : " off"; sub = s.gov ? gn : (s.tie ? "동점" : (s.owner === me ? "내 자리" : "낙찰")); }
      else if (inDraft) c += " pick";
      if (sent && this.locked()) c += " sent";
      if (s.owner === me) c += " me";
      return '<button type="button" class="' + c + '" data-s="' + s.no + '">' + s.no + (sub ? '<span class="s">' + sub + '</span>' : "") + '</button>';
    }
    // 보기용
    if (s.gov) { c += " gov"; sub = s.sitter != null ? (s.sitter === me ? "나" : "") : gn; }
    else if (s.owner != null) { sub = s.owner === me ? "내 자리" : ""; if (s.owner !== me) c += " off"; }
    else if (s.tie) { c += s.tie.cands.indexOf(me) >= 0 ? " tie" : " off"; sub = "동점"; }
    if (s.owner === me || s.sitter === me) c += " me";
    return '<div class="' + c + '">' + s.no + (sub ? '<span class="s">' + sub + '</span>' : "") + '</div>';
  };
  P.fitMap = function () {
    var m = this.root.querySelector("[data-smap]"); if (!m) return;
    var S = this.S(), w = (m.clientWidth || 320) - 8;
    var sc = Math.max(34, Math.min(60, Math.floor((w - (S.cols - 1) * 5) / S.cols)));
    m.style.setProperty("--sc", sc + "px");
  };

  P.bodyHTML = function () {
    var r = this.st.room, u = this.unit();
    var ph = r.phase;
    if (ph === "lobby") return this.lobbyHTML();
    if (ph === "bidding") return this.bidHTML();
    if (ph === "closed") return '<div class="st-card st-wait"><div class="st-big">마감</div><div class="st-mid">공개를 기다려요</div></div>' + this.sentHTML();
    if (ph === "revealed") {
      if (r.reveal_at && this.clock.left(r.reveal_at) > 0)
        return '<div class="st-card st-wait"><div class="bigseat" data-cd>' + Math.ceil(this.clock.left(r.reveal_at) / 1000) + '</div><div class="st-mid">공개</div></div>';
      return this.resultHTML();
    }
    if (ph === "ending") return '<div class="st-card st-wait"><div class="st-big">경매 종료</div><div class="st-mid">잠시 기다려요</div></div>' + this.ownHTML();
    if (ph === "seatpick") return this.pickHTML();
    if (ph === "rent") return this.rentHTML();
    if (ph === "done") return this.doneHTML();
    return "";
  };

  P.lobbyHTML = function () {
    var me = this.me(), u = this.unit();
    if (this.assetEdit) {
      return '<div class="st-card"><div class="lbl" style="font-weight:800;margin-bottom:8px">보유 자산 (' + u + ')</div>' +
        '<div class="amtbox"><input class="input" data-keep="assets" data-assets inputmode="numeric" value="' + (me.assets == null ? "" : me.assets) + '">' +
        '<button class="btn pri" data-saveassets>저장</button><button class="btn ghost" data-cancel>취소</button></div></div>';
    }
    return '<div class="st-card st-wait"><div class="st-big">입장 완료</div><div class="st-mid">선생님이 시작할 때까지 기다려요</div></div>' +
      '<div class="st-card"><div class="row" style="justify-content:space-between"><div><div class="note">보유 자산</div>' +
      '<div style="font-size:30px;font-weight:900">' + num(me.assets) + ' <small style="font-size:16px">' + u + '</small></div></div>' +
      '<button class="btn" data-editassets>수정</button></div><div class="note">경매가 시작되면 고칠 수 없어요</div></div>';
  };

  P.bidHTML = function () {
    var me = this.me(), S = this.S(), u = this.unit(), sp = +(S.startPrice || 0), self = this;
    if (me.allowed === 0) return '<div class="st-card st-wait"><div class="st-big">이번 차수 쉬기</div><div class="st-mid">입찰 가능 자리 0</div></div>' + this.ownHTML();
    if ((me.assets || 0) < sp && !this.submitted()) return '<div class="st-card st-wait"><div class="st-big">이번 차수 쉬기</div><div class="st-mid">시작가 ' + num(sp) + ' ' + u + ' · 보유 자산 부족</div></div>';
    var locked = this.locked(), timeUp = r_timeUp(this);
    var html = '<div class="st-card">' + (locked ? "" : '<div class="note" style="text-align:center;margin:0 0 8px">자리를 눌러 고르기 · 시작가 ' + num(sp) + ' ' + u + '</div>') +
      this.mapHTML("bid") + '</div>';
    if (!locked) {
      html += '<div class="st-card"><div class="bidlist">' + (this.draft.length ? this.draft.map(function (d) {
        return '<div class="bidrow' + (self.sel === d.seat ? " sel" : "") + '" data-row="' + d.seat + '"><span class="sn">' + d.seat + '번</span>' +
          '<input class="input amt" data-keep="amt' + d.seat + '" data-amt="' + d.seat + '" inputmode="numeric" value="' + d.amount + '" style="flex:1">' +
          '<button class="btn ghost" data-del="' + d.seat + '" aria-label="빼기" style="min-height:44px;padding:6px 12px">빼기</button></div>';
      }).join("") : '<div class="note" style="text-align:center">고른 자리 없음</div>') + '</div>' +
      (this.sel != null && this.draft.some(function (d) { return d.seat === self.sel; }) ?
        '<div class="stepper">' + [[-10, "−10"], [10, "+10"], [50, "+50"], [100, "+100"], ["max", "최대"]].map(function (x) {
          return '<button type="button" class="btn" data-step="' + x[0] + '">' + x[1] + '</button>'; }).join("") + '</div>' : "") +
      '</div>';
    }
    // 제출 막대
    var sentLine = this.sentLine();
    var bar = "";
    if (timeUp) bar = '<button class="btn lg done" disabled>마감</button>';
    else if (locked) bar = '<div class="row" style="flex-wrap:nowrap"><button class="btn lg done" disabled style="flex:2">제출됨</button><button class="btn lg" data-edit style="flex:1">수정</button></div>';
    else bar = '<div class="row" style="flex-wrap:nowrap"><button class="btn lg pri" data-submit style="flex:2"' + (this.draft.length || this.editing ? "" : " disabled") + '>제출</button>' +
      (this.editing ? '<button class="btn lg" data-canceledit style="flex:1">취소</button>' : "") + '</div>';
    html += '<div class="submitbar"><div class="in">' + (sentLine ? '<div class="sent">' + sentLine + '</div>' : "") + bar + '</div></div>';
    return html;
  };
  function r_timeUp(self) { var r = self.st.room; return r.phase === "bidding" && r.deadline && self.clock.left(r.deadline) <= 0; }

  P.sentLine = function () {
    var u = this.unit();
    if (!this.st.mybids.length) return "";
    return "제출된 입찰 · " + this.st.mybids.map(function (b) { return b.seat + "번 " + num(b.amount); }).join(" · ") + " " + u;
  };
  P.sentHTML = function () {
    var u = this.unit();
    if (!this.st.mybids.length) return '<div class="st-card"><div class="st-mid">이번 차수 입찰 안 함</div></div>';
    return '<div class="st-card"><div class="note" style="margin:0 0 8px">제출된 입찰</div><div class="bidlist">' + this.st.mybids.map(function (b) {
      return '<div class="bidrow"><span class="sn">' + b.seat + '번</span><span class="amt">' + num(b.amount) + ' <small>' + u + '</small></span></div>';
    }).join("") + '</div></div>';
  };

  P.resultHTML = function () {
    var self = this, me = this.me().no, r = this.st.room, u = this.unit(), m = this.seatMap();
    var rows = this.st.mybids.map(function (b) {
      var s = m[b.seat] || {};
      if (s.tie && s.tie.cands.indexOf(me) >= 0) return '<div class="result tie"><span class="lab">동점</span><span>' + b.seat + '번</span><span class="r2">' + num(b.amount) + '</span></div>';
      if (s.owner === me && s.won_round === r.round) return '<div class="result win"><span class="lab">낙찰</span><span>' + b.seat + '번</span><span class="r2">' + num(b.amount) + '</span></div>';
      return '<div class="result lose"><span class="lab">낙찰 실패</span><span>' + b.seat + '번</span><span class="r2">' + num(b.amount) + '</span></div>';
    });
    var html = '<div class="st-card">' + (rows.length ? rows.join("") : '<div class="st-mid">이번 차수 입찰 안 함</div>') +
      (rows.length ? '<div class="note" style="text-align:right">단위 ' + u + '</div>' : "") + '</div>';
    return html + '<div class="st-card">' + this.mapHTML("view") + '</div>';
  };

  P.ownHTML = function () {
    var mine = this.mySeats(), u = this.unit();
    if (!mine.length) return "";
    return '<div class="st-card"><div class="note" style="margin:0 0 8px">내가 가진 자리</div>' + mine.map(function (s) {
      return '<div class="result win"><span class="lab">' + s.no + '번</span><span class="r2">' + num(s.price) + ' ' + u + '</span></div>';
    }).join("") + '</div>';
  };

  P.pickHTML = function () {
    var me = this.me().no, mine = this.mySeats();
    var pres = this.st.seats.some(function (s) { return s.gov && s.sitter === me; });
    if (mine.length < 2 || pres) {
      var sit = this.mySit();
      return '<div class="st-card st-wait"><div class="st-big">잠시 기다려요</div><div class="st-mid">다른 친구가 앉을 자리를 고르는 중</div></div>' +
        (sit ? '<div class="st-card"><div class="note" style="text-align:center">내 자리</div><div class="bigseat">' + sit.no + '</div></div>' : this.ownHTML());
    }
    return '<div class="st-card"><div class="st-big" style="font-size:26px">앉을 자리 고르기</div><div class="st-mid" style="margin-bottom:12px">나머지 자리는 빌려줄 수 있어요</div>' +
      '<div class="row" style="justify-content:center">' + mine.map(function (s) {
        var on = s.sitter === me;
        return '<button class="btn lg' + (on ? " pri" : "") + '" data-pick="' + s.no + '" style="min-width:110px;font-size:26px">' + s.no + '번' + (on ? " ✓" : "") + '</button>';
      }).join("") + '</div></div>' + this.mapHTML("view");
  };

  P.rentHTML = function () {
    var self = this, me = this.me().no, u = this.unit(), sit = this.mySit();
    var lend = this.mySeats().filter(function (s) { return s.sitter !== me; });
    var html = '<div class="st-card">' + (sit ? '<div class="note" style="text-align:center">내 자리</div><div class="bigseat">' + sit.no + '</div>' +
        (sit.gov || (sit.owner != null && sit.owner !== me) ? '<div class="st-mid">임대료 ' + (sit.rent != null ? num(sit.rent) + " " + u : "-") + '</div>' : "")
      : '<div class="st-big">자리 없음</div><div class="st-mid">선생님 안내를 기다려요</div>') + '</div>';
    if (lend.length) {
      html += '<div class="st-card"><div style="font-weight:900;font-size:18px;margin-bottom:10px">빌려줄 자리 · 임대료</div><div class="bidlist">' +
        lend.map(function (s) {
          if (s.sitter != null && s.rent != null) return '<div class="bidrow"><span class="sn">' + s.no + '번</span><span style="flex:1">임차인 <b>' + esc(s.sitter_nick || "") + '</b></span>' +
            '<span class="amt" style="flex:none">' + num(s.rent) + ' <small>' + u + '</small></span></div>';
          return '<div class="bidrow" style="flex-wrap:wrap"><span class="sn">' + s.no + '번</span>' +
            (s.sitter != null ? '<span style="flex-basis:100%;order:3;font-weight:800">임차인 ' + esc(s.sitter_nick || "") + '</span>' : "") +
            '<input class="input amt" data-keep="rent' + s.no + '" data-rent="' + s.no + '" inputmode="numeric" placeholder="임대료" value="' + (s.rent != null ? s.rent : "") + '" style="flex:1">' +
            '<button class="btn' + (s.rent == null ? " pri" : "") + '" data-saverent="' + s.no + '">' + (s.rent == null ? "저장" : "저장됨") + '</button></div>';
        }).join("") + '</div><div class="note">0도 괜찮아요 · 임차인이 정해지면 바꿀 수 없어요</div></div>';
    }
    return html + '<div class="st-card">' + this.mapHTML("view") + '</div>';
  };

  P.doneHTML = function () {
    var me = this.me().no, u = this.unit(), sit = this.mySit();
    var lend = this.mySeats().filter(function (s) { return s.sitter !== me && s.sitter != null; });
    var html = '<div class="st-card"><div class="note" style="text-align:center">내 자리</div>' +
      (sit ? '<div class="bigseat">' + sit.no + '</div>' : '<div class="st-big">선생님께 물어보세요</div>');
    if (sit && (sit.gov || (sit.owner != null && sit.owner !== me))) html += '<div class="st-mid">임대료 ' + (sit.rent != null ? num(sit.rent) + " " + u : "-") + '</div>';
    html += '</div>';
    if (lend.length) html += '<div class="st-card"><div class="note" style="margin:0 0 8px">빌려준 자리</div><div class="bidlist">' + lend.map(function (s) {
      return '<div class="bidrow"><span class="sn">' + s.no + '번</span><span style="flex:1">임차인 <b>' + esc(s.sitter_nick || "") + '</b></span><span class="amt" style="flex:none">' + num(s.rent) + ' <small>' + u + '</small></span></div>';
    }).join("") + '</div></div>';
    return html + '<div class="st-card">' + this.mapHTML("view") + '</div>';
  };

  /* ---------------- 누르기 ---------------- */
  P.bindBody = function () {
    var self = this, q = function (s) { return self.root.querySelectorAll(s); };
    var one = function (s) { return self.root.querySelector(s); };
    // 대기실
    if (one("[data-editassets]")) one("[data-editassets]").onclick = function () { self.assetEdit = true; self.lastKey = ""; self.render(); var i = one("[data-assets]"); if (i) i.focus(); };
    if (one("[data-cancel]")) one("[data-cancel]").onclick = function () { self.assetEdit = false; self.lastKey = ""; self.render(); };
    if (one("[data-saveassets]")) one("[data-saveassets]").onclick = function () {
      var v = one("[data-assets]").value.replace(/[,\s]/g, ""), a = Math.round(+v);
      if (v === "" || isNaN(a) || a < 0) return self.toast("보유 자산을 숫자로 넣어 주세요");
      self.call(self.be.sAssets(self.sess.code, self.sess.no, self.sess.token, a)).then(function () { self.assetEdit = false; self.lastKey = ""; return self.refresh(); });
    };
    // 입찰
    q("[data-s]").forEach(function (b) { b.onclick = function () { self.toggleSeat(+b.dataset.s); }; });
    q("[data-row]").forEach(function (row) {
      row.addEventListener("click", function (ev) { if (ev.target.closest("[data-del]")) return; if (self.sel !== +row.dataset.row) { self.sel = +row.dataset.row; self.lastKey = ""; self.render(); } });
    });
    q("[data-amt]").forEach(function (inp) {
      inp.addEventListener("focus", function () { inp.select(); if (self.sel !== +inp.dataset.amt) { self.sel = +inp.dataset.amt; self.markSel(); } });
      inp.addEventListener("input", function () { self.setAmount(+inp.dataset.amt, inp.value, inp); });
      inp.addEventListener("blur", function () {
        var d = self.find(+inp.dataset.amt); if (!d) return;
        var sp = +(self.S().startPrice || 0);
        if (d.amount < sp) { d.amount = sp; inp.value = sp; self.dash(); }
      });
    });
    q("[data-del]").forEach(function (b) { b.onclick = function () { self.toggleSeat(+b.dataset.del); }; });
    q("[data-step]").forEach(function (b) {
      b.onclick = function () {
        var d = self.find(self.sel); if (!d) return;
        var room = (self.me().assets || 0) - (self.total() - d.amount), sp = +(self.S().startPrice || 0);
        var v = b.dataset.step === "max" ? room : d.amount + (+b.dataset.step);
        if (v > room) { self.flashOver(); v = room; }
        v = Math.max(sp, v);
        if (v > room) return self.flashOver();
        d.amount = v;
        var inp = one('[data-amt="' + d.seat + '"]'); if (inp) inp.value = v;
        self.dash();
      };
    });
    if (one("[data-submit]")) one("[data-submit]").onclick = function () { self.submit(); };
    if (one("[data-edit]")) one("[data-edit]").onclick = function () {
      self.editing = true; self.draft = self.st.mybids.map(function (b) { return { seat: b.seat, amount: b.amount }; });
      self.sel = self.draft.length ? self.draft[0].seat : null; self.lastKey = ""; self.render();
    };
    if (one("[data-canceledit]")) one("[data-canceledit]").onclick = function () {
      self.editing = false; self.draft = self.st.mybids.map(function (b) { return { seat: b.seat, amount: b.amount }; });
      self.sel = null; self.lastKey = ""; self.render();
    };
    // 자리 고르기
    q("[data-pick]").forEach(function (b) {
      b.onclick = function () { self.call(self.be.sPick(self.sess.code, self.sess.no, self.sess.token, +b.dataset.pick)).then(function () { return self.refresh(); }); };
    });
    // 임대료
    q("[data-saverent]").forEach(function (b) {
      b.onclick = function () {
        var no = +b.dataset.saverent, inp = one('[data-rent="' + no + '"]'), v = inp.value.replace(/[,\s]/g, ""), a = Math.round(+v);
        if (v === "" || isNaN(a) || a < 0) return self.toast("임대료를 숫자로 넣어 주세요");
        inp.blur();
        self.call(self.be.sRent(self.sess.code, self.sess.no, self.sess.token, no, a)).then(function () { self.toast(no + "번 임대료 " + num(a)); return self.refresh(); });
      };
    });
    q("[data-rent]").forEach(function (inp) {
      inp.addEventListener("input", function () { var b = one('[data-saverent="' + inp.dataset.rent + '"]'); if (b) { b.textContent = "저장"; b.classList.add("pri"); } });
    });
  };

  P.call = function (p) {
    var self = this; this.busy = true;
    return p.then(function (r) { self.busy = false; return r; }, function (e) { self.busy = false; self.toast(SA.errText(e)); throw e; })
      .catch(function () { return self.refresh(); });
  };
  P.find = function (seat) { return this.draft.filter(function (d) { return d.seat === seat; })[0]; };
  P.markSel = function () {
    var self = this;
    this.root.querySelectorAll("[data-row]").forEach(function (r) { r.classList.toggle("sel", +r.dataset.row === self.sel); });
    if (!this.root.querySelector(".stepper")) { this.lastKey = ""; this.render(); }
  };
  P.flashOver = function () {
    var self = this; this._over = true; this.lastDash = ""; this.dash();
    clearTimeout(this._ot); this._ot = setTimeout(function () { self._over = false; self.lastDash = ""; self.dash(); }, 900);
  };

  P.toggleSeat = function (no) {
    if (this.locked()) return;
    var s = this.seatMap()[no]; if (!s || !SA.isOpenSeat(s)) return;
    var ix = -1; this.draft.forEach(function (d, i) { if (d.seat === no) ix = i; });
    if (ix >= 0) { this.draft.splice(ix, 1); if (this.sel === no) this.sel = null; }
    else {
      var al = this.me().allowed, sp = +(this.S().startPrice || 0);
      if (al >= 0 && this.draft.length >= al) { this.toast("입찰 가능 자리 " + al + "개"); return; }
      if (this.total() + sp > (this.me().assets || 0)) { this.flashOver(); this.toast("입찰 가능 금액 부족"); return; }
      this.draft.push({ seat: no, amount: sp }); this.sel = no;
      this.draft.sort(function (a, b) { return a.seat - b.seat; });
    }
    this.lastKey = ""; this.render();
    var inp = this.root.querySelector('[data-amt="' + no + '"]');
    if (inp && ix < 0 && !this.opts.demo) inp.focus();
  };

  P.setAmount = function (seat, raw, inp) {
    var d = this.find(seat); if (!d) return;
    var digits = String(raw).replace(/[^\d]/g, "");
    var v = digits === "" ? 0 : parseInt(digits, 10);
    var room = (this.me().assets || 0) - (this.total() - d.amount);
    if (v > room) { this.flashOver(); v = d.amount > room ? room : d.amount; inp.value = v; }
    else if (digits !== String(raw)) inp.value = digits;
    d.amount = v; this.dash();
  };

  P.submit = function () {
    var self = this, sp = +(this.S().startPrice || 0);
    var bids = this.draft.map(function (d) { return { seat: d.seat, amount: Math.max(sp, +d.amount || 0) }; });
    if (bids.reduce(function (a, b) { return a + b.amount; }, 0) > (this.me().assets || 0)) { this.flashOver(); return this.toast("입찰 가능 금액을 넘었어요"); }
    var btn = this.root.querySelector("[data-submit]"); if (btn) { btn.disabled = true; btn.textContent = "보내는 중…"; }
    this.busy = true;
    this.be.sBid(this.sess.code, this.sess.no, this.sess.token, bids).then(function () {
      self.busy = false; self.editing = false; self.sel = null;
      return self.refresh().then(function () {
        self.draft = self.st.mybids.map(function (b) { return { seat: b.seat, amount: b.amount }; });
        self.toast(bids.length ? "제출했어요" : "입찰을 모두 뺐어요");
        self.lastKey = ""; self.render();
      });
    }, function (e) {
      self.busy = false; self.toast(SA.errText(e)); self.lastKey = ""; self.render();
    });
  };
})(window);
