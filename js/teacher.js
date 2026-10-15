/* 학급 자리 경매 · 교사 화면 */
(function (W) {
  "use strict";
  var SA = W.SA, esc = SA.esc, num = SA.num;
  var LKEY_SESSION = "sa-teacher", LKEY_LAST = "sa-last-settings";
  var POLL = 1500;

  function TeacherApp(root, backend, opts) {
    this.root = root; this.be = backend; this.opts = opts || {};
    this.clock = new SA.Clock();
    this.st = null; this.sess = null; this.view = "start";
    this.pop = null; this.overlay = false; this.endChoice = {}; this.flipDone = {};
    this.lastMain = ""; this.lastTop = ""; this.lastBottom = "";
    var self = this;
    this._tick = setInterval(function () { self.tick(); }, 250);
    W.addEventListener("resize", function () { self.fit(); });
  }
  var T = TeacherApp.prototype;
  SA.TeacherApp = TeacherApp;

  T.toast = function (msg) {
    var t = SA.h("div", { class: "toast" }, esc(msg));
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 2600);
  };
  T.err = function (e) { this.toast(SA.errText(e)); };

  /* ---------------- 시작 ---------------- */
  T.boot = function () {
    var self = this;
    if (this.opts.demo) return this.startDemo();
    var s = SA.store.get(LKEY_SESSION);
    if (s && s.code && s.token) {
      this.be.tState(s.code, s.token).then(function (st) { self.enter(s, st); })
        .catch(function () { SA.store.del(LKEY_SESSION); self.renderStart(); });
    } else this.renderStart();
  };

  T.renderStart = function () {
    var self = this; this.view = "start"; this.stopPoll();
    var last = SA.store.get(LKEY_LAST);
    var lastDate = last && last.savedAt ? new Date(last.savedAt) : null;
    
    this.root.innerHTML =
      '<div class="start"><div class="start-box">' +
      '<div class="start-title">자리 경매</div>' +
      '<p class="start-sub">학급 화폐로 자리를 정하고, 임대까지 한 번에</p>' +
      '<div class="start-list">' +
        '<div class="start-item"><button class="btn pri" data-a="new">새 경매 시작</button></div>' +
        (last ? '<div class="start-item"><button class="btn" data-a="last">지난 설정으로 시작</button>' +
          '<div class="note">이 컴퓨터에 저장된 설정 · ' + (lastDate ? (lastDate.getMonth() + 1) + "월 " + lastDate.getDate() + "일" : "") + '</div></div>' : "") +
        '<div class="start-item"><button class="btn" data-a="file">설정 파일 불러오기</button><input type="file" accept=".json,application/json" hidden></div>' +
        '<div class="start-item"><button class="btn" data-a="resume">이어하기</button><div class="note">진행 중인 경매 · 24시간 동안 보관</div>' +
          '<form class="card" data-f="resume" hidden style="margin-top:10px">' +
            '<div class="grid2"><label class="field">방 코드<input class="input" name="code" inputmode="numeric" maxlength="6" autocomplete="off"></label>' +
            '<label class="field">교사 암호<input class="input" name="pin" type="password" autocomplete="off"></label></div>' +
            '<div class="row" style="margin-top:12px"><button class="btn pri">들어가기</button><span class="err"></span></div>' +
          '</form></div>' +
      '</div>' +
      '<div class="start-foot"><button class="linkbtn" data-a="demo">체험하기 · 학생 없이 전체 흐름 해 보기</button></div>' +
      '</div></div>';
    var q = function (s) { return self.root.querySelector(s); };
    q('[data-a="new"]').onclick = function () { self.renderSetup(SA.defaultSettings()); };
    if (last) q('[data-a="last"]').onclick = function () { self.renderSetup(last.settings); };
    var fin = q('input[type="file"]');
    q('[data-a="file"]').onclick = function () { fin.click(); };
    fin.onchange = function () {
      var f = fin.files[0]; if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        try {
          var j = JSON.parse(rd.result);
          if (!j || j.app !== "seat-auction" || !j.settings || !j.settings.cells) throw 0;
          self.renderSetup(j.settings);
        } catch (e) { self.toast("자리 경매 설정 파일이 아니에요"); }
      };
      rd.readAsText(f);
    };
    var form = q('[data-f="resume"]');
    q('[data-a="resume"]').onclick = function () { form.hidden = !form.hidden; if (!form.hidden) form.code.focus(); };
    form.onsubmit = function (ev) {
      ev.preventDefault();
      var code = form.code.value.trim(), pin = form.pin.value.trim(), out = form.querySelector(".err");
      out.textContent = "확인 중…";
      self.be.tLogin(code, pin).then(function (r) {
        return self.be.tState(r.code, r.token).then(function (st) { self.enter({ code: r.code, token: r.token }, st); });
      }).catch(function (e) { out.textContent = SA.errText(e); });
    };
    q('[data-a="demo"]').onclick = function () {
      location.href = location.href.split("#")[0].split("?")[0] + "?demo=1";
    };
  };

  /* ---------------- 설정 ---------------- */
  T.renderSetup = function (S0, edit) {
    var self = this; this.view = "setup"; this.stopPoll(); this.closePop();
    var joined = edit && this.st ? this.st.students.slice() : [];
    var S = JSON.parse(JSON.stringify(Object.assign(SA.defaultSettings(), S0 || {})));
    var numEdit = false, tpl = "mine";
    
    this.root.innerHTML = '<div class="page" data-setup></div>';
    var host = this.root.querySelector("[data-setup]");

    function seg(name, val, items) {
      return '<div class="seg" data-seg="' + name + '">' + items.map(function (it) {
        return '<button type="button" data-v="' + esc(it[0]) + '" aria-pressed="' + (String(val) === String(it[0])) + '">' + esc(it[1]) + '</button>';
      }).join("") + '</div>';
    }
    function renumber() { S.nums = SA.autoNumber(S.rows, S.cols, S.cells, S.corner, S.dir); }
    function resize(r, c) {
      r = Math.max(1, Math.min(15, r | 0)); c = Math.max(1, Math.min(15, c | 0));
      var cells = [];
      for (var y = 0; y < r; y++) for (var x = 0; x < c; x++) cells.push(y < S.rows && x < S.cols ? S.cells[y * S.cols + x] : "E");
      S.rows = r; S.cols = c; S.cells = cells; renumber();
    }

    function render() {
      var chk = SA.checkLayout(S), n = +S.studentCount || 0;
      var govSeats = [];
      S.cells.forEach(function (t, ix) { if (t === "G") govSeats.push(S.nums[ix]); });
      var timerVals = [[0, "없음"], [60, "1분"], [120, "2분"], [180, "3분"]];
      var custom = timerVals.every(function (t) { return t[0] !== +S.timer; });
      host.innerHTML =
        (edit ? '<h1>설정 수정</h1><p class="lead">방 ' + esc(self.sess.code) + ' · 들어온 학생 ' + joined.length + '명은 그대로예요</p>'
               : '<h1>새 경매 설정</h1><p class="lead">위에서부터 차례로 채우고 맨 아래에서 방을 만드세요.</p>') +

        '<div class="card"><div class="step"><b>1</b><h2>학급 정보</h2></div><div class="grid2">' +
          '<label class="field">화폐 단위<input class="input" data-k="unit" value="' + esc(S.unit) + '" maxlength="8"><small>예: 패티, 원, 포인트, 도장</small></label>' +
          '<label class="field">국유지 이름<input class="input" data-k="govName" value="' + esc(S.govName) + '" maxlength="8"><small>예: 국유지, 지정석</small></label>' +
          '<label class="field">학생 수<input class="input" data-k="studentCount" type="number" min="1" max="60" value="' + n + '"></label>' +
        '</div></div>' +

        '<div class="card"><div class="step"><b>2</b><h2>자리 배치</h2></div>' +
          '<div class="row" style="margin-bottom:12px">' + seg("tpl", tpl, [["line", "한 줄씩"], ["pair", "짝"], ["g4", "모둠 4인"], ["g6", "모둠 6인"], ["u", "ㄷ자"]]) +
            '<span class="note">고르면 학생 수에 맞춰 채워져요</span></div>' +
          '<div class="row" style="margin-bottom:12px">' +
            '<label class="field" style="width:100px">줄<input class="input" data-k="rows" type="number" min="1" max="15" value="' + S.rows + '"></label>' +
            '<label class="field" style="width:100px">칸<input class="input" data-k="cols" type="number" min="1" max="15" value="' + S.cols + '"></label>' +
            '<div class="field">교탁 위치' + seg("deskPos", S.deskPos, [["top", "위"], ["bottom", "아래"]]) + '</div>' +
          '</div>' +
          '<div class="row" style="margin-bottom:12px">' +
            '<div class="field">1번 자리' + seg("corner", S.corner, [["tl", "왼쪽 위"], ["tr", "오른쪽 위"], ["bl", "왼쪽 아래"], ["br", "오른쪽 아래"]]) + '</div>' +
            '<div class="field">번호 방향' + seg("dir", S.dir, [["row", "가로"], ["col", "세로"]]) + '</div>' +
            '<div class="field">&nbsp;<button type="button" class="btn' + (numEdit ? " pri" : "") + '" data-a="numedit">' + (numEdit ? "번호 고치기 끝" : "번호 직접 고치기") + '</button></div>' +
          '</div>' +
          '<div class="legend-row" style="margin-bottom:8px"><span><i style="background:#fff;border:1.5px solid #9aa6b8"></i>자리</span>' +
            '<span><i style="border:1.5px dashed #c3cbd8"></i>빈칸</span><span><i style="background:#d7f3f3;border:1.5px solid var(--gov)"></i>' + esc(S.govName) + '</span>' +
            '<span>칸을 누를 때마다 자리 → 빈칸 → ' + esc(S.govName) + '</span></div>' +
          '<div class="editor">' + (S.deskPos === "top" ? '<div class="ed-desk">교탁</div>' : "") +
            '<div class="ed-grid" style="grid-template-columns:repeat(' + S.cols + ',46px)">' +
            S.cells.map(function (t, ix) {
              if (numEdit && t !== "E") return '<div class="ed-cell ' + t + '"><input data-num="' + ix + '" inputmode="numeric" value="' + (S.nums[ix] || "") + '"></div>';
              return '<button type="button" class="ed-cell ' + t + '" data-cell="' + ix + '">' + (t !== "E" ? (S.nums[ix] || "") : "") + '</button>';
            }).join("") + '</div>' +
            (S.deskPos !== "top" ? '<div class="ed-desk">교탁</div>' : "") + '</div>' +
          (chk.dupNumbers ? '<p class="err">겹치거나 빠진 번호가 있어요</p>' : "") +
        '</div>' +

        (govSeats.length ? '<div class="card"><div class="step"><b>3</b><h2>' + esc(S.govName) + ' 미리 배정 <span class="note">(선택)</span></h2></div>' +
          '<p class="note" style="margin:0 0 10px">배려가 필요한 학생을 경매 전에 앉힐 수 있어요. 학생 번호로 정해요.</p><div class="grid2">' +
          govSeats.map(function (no) {
            var cur = S.presat[no] || "";
            var opts = '<option value="">비워 두기</option>';
            for (var i = 1; i <= n; i++) opts += '<option value="' + i + '"' + (+cur === i ? " selected" : "") + '>' + i + '번 학생</option>';
            return '<label class="field">' + no + '번 자리<select class="input" data-presat="' + no + '">' + opts + '</select></label>';
          }).join("") + '</div></div>' : "") +

        '<div class="card"><div class="step"><b>' + (govSeats.length ? 4 : 3) + '</b><h2>경매 규칙</h2></div>' +
          '<div class="grid2">' +
            '<label class="field">시작가 (' + esc(S.unit) + ')<input class="input" data-k="startPrice" type="number" min="0" value="' + (+S.startPrice || 0) + '"><small>0이면 누구나 0으로 입찰할 수 있어요</small></label>' +
            '<div class="field" style="grid-column:1/-1">자리 소유' + seg("own", +S.maxSeats === 1 ? "one" : "multi", [["one", "한 명당 한 자리"], ["multi", "여러 자리 (임대 가능)"]]) +
              (+S.maxSeats === 1 ? '<small>모두 한 자리씩 · 임대는 ' + esc(S.govName) + '만</small>' :
                '<div class="row" style="margin-top:6px;gap:16px"><div class="field">최대' + seg("maxSeats", S.maxSeats, [[2, "2자리"], [3, "3자리"], [0, "제한 없음"]]) + '</div>' +
                '<div class="field">차수마다 입찰' + seg("perRound", +S.perRound === 1 ? 1 : 0, [[1, "한 자리씩"], [0, "여러 자리"]]) + '</div></div>' +
                '<small>남는 자리 임대 가능</small>') + '</div>' +
            '<div class="field">동점' + seg("tieMode", S.tieMode, [["auto", "자동 추첨"], ["teacher", "교사 선택"]]) + '</div>' +
            '<div class="field">입찰 시간' + seg("timer", custom ? "x" : S.timer, timerVals.concat([["x", "직접"]])) +
              (custom ? '<input class="input" data-k="timer" type="number" min="10" max="900" value="' + (+S.timer || 90) + '" style="margin-top:6px"><small>초 단위</small>' : "") + '</div>' +
            '<div class="field">끝까지 입찰 안 한 학생' + seg("nonPart", S.nonPart, [["random", "추첨 배정"], ["gov", esc(S.govName) + " 우선"], ["teacher", "교사가 지정"]]) + '</div>' +
          '</div></div>' +

        (edit ? "" : '<div class="card"><div class="step"><b>' + (govSeats.length ? 5 : 4) + '</b><h2>교사 암호</h2></div>' +
          '<label class="field" style="max-width:300px">암호 (4~12자)<input class="input" data-pin type="password" autocomplete="new-password" maxlength="12"><small>창이 닫혔을 때 이어하기에 필요해요</small></label>' +
        '</div>') +

        '<div class="card"><h2>점검</h2><div class="check">' +
          '<span>학생 ' + n + '</span>' +
          '<span class="' + (chk.seats === n ? "good" : "bad") + '">자리 ' + chk.seats + ' (경매 ' + chk.auction + ' · ' + esc(S.govName) + ' ' + chk.gov + ')</span>' +
        '</div>' +
          (chk.seats < n ? '<p class="err">자리가 ' + (n - chk.seats) + '개 모자라요</p>' : chk.seats > n ? '<p class="note">자리가 ' + (chk.seats - n) + '개 남아요</p>' : "") +
          '<div class="row" style="margin-top:14px"><button class="btn lg pri" data-a="create">' + (edit ? "저장하고 대기실로" : "방 만들기") + '</button>' +
          '<button class="btn ghost" data-a="back">' + (edit ? "취소" : "처음으로") + '</button><span class="err" data-out></span></div>' +
        '</div>';
      bind();
    }

    function bind() {
      host.querySelectorAll("[data-k]").forEach(function (el) {
        el.onchange = function () {
          var k = el.dataset.k, v = el.value;
          if (k === "rows" || k === "cols") { resize(k === "rows" ? +v : S.rows, k === "cols" ? +v : S.cols); tpl = "mine"; }
          else if (k === "studentCount") S.studentCount = Math.max(1, Math.min(60, +v || 1));
          else if (k === "startPrice") S.startPrice = Math.max(0, +v || 0);
          else if (k === "timer") S.timer = Math.max(10, Math.min(900, +v || 90));
          else S[k] = v.trim() || (k === "unit" ? "패티" : "국유지");
          render();
        };
      });
      host.querySelectorAll("[data-seg]").forEach(function (g) {
        g.querySelectorAll("button").forEach(function (b) {
          b.onclick = function () {
            var k = g.dataset.seg, v = b.dataset.v;
            if (k === "tpl") {
              tpl = v; var t = SA.makeTemplate(v, +S.studentCount || 26);
              S.rows = t.rows; S.cols = t.cols; S.cells = t.cells; S.presat = {}; renumber();
            } else if (k === "maxSeats") S.maxSeats = +v;
            else if (k === "own") { if (v === "one") S.maxSeats = 1; else if (+S.maxSeats === 1) S.maxSeats = 2; }
            else if (k === "perRound") S.perRound = +v;
            else if (k === "timer") S.timer = v === "x" ? 90 : +v;
            else { S[k] = v; if (k === "corner" || k === "dir") renumber(); }
            render();
          };
        });
      });
      host.querySelectorAll("[data-cell]").forEach(function (b) {
        b.onclick = function () {
          var ix = +b.dataset.cell, t = S.cells[ix];
          S.cells[ix] = t === "S" ? "E" : t === "E" ? "G" : "S";
          tpl = "mine"; renumber(); render();
        };
      });
      host.querySelectorAll("[data-num]").forEach(function (inp) {
        inp.onchange = function () { S.nums[+inp.dataset.num] = Math.max(1, +inp.value || 0) || null; };
      });
      host.querySelectorAll("[data-presat]").forEach(function (sel) {
        sel.onchange = function () { if (sel.value) S.presat[sel.dataset.presat] = +sel.value; else delete S.presat[sel.dataset.presat]; };
      });
      host.querySelector('[data-a="numedit"]').onclick = function () { numEdit = !numEdit; render(); };
      host.querySelector('[data-a="back"]').onclick = function () {
        if (!edit) return self.renderStart();
        self.fresh().then(function (st) { self.enter(self.sess, st); }, function (e) { self.err(e); });
      };
      host.querySelector('[data-a="create"]').onclick = function () {
        var out = host.querySelector("[data-out]"), pinEl = host.querySelector("[data-pin]"), pin = pinEl ? pinEl.value.trim() : "";
        var chk = SA.checkLayout(S);
        if (chk.dupNumbers) { out.textContent = "자리 번호를 확인하세요"; return; }
        if (chk.auction < 1) { out.textContent = "경매할 자리가 없어요"; return; }
        if (!edit && pin.length < 4) { out.textContent = "교사 암호를 4자 이상 넣어 주세요"; return; }
        // 국유지가 아닌 자리에 남은 미리 배정 지우기
        var govNos = {}; S.cells.forEach(function (t, ix) { if (t === "G") govNos[S.nums[ix]] = 1; });
        Object.keys(S.presat).forEach(function (k) { if (!govNos[k]) delete S.presat[k]; });
        if (edit) {
          var n = +S.studentCount, gone = joined.filter(function (p) { return p.no > n; });
          var go = function () {
            out.textContent = "저장 중…";
            self.saveSetup(S).catch(function (e) { out.textContent = SA.errText(e); });
          };
          if (gone.length) return SA.arm(this, gone.map(function (p) { return p.no; }).join("·") + "번이 나가요 · 한 번 더", go);
          return go();
        }
        out.textContent = "만드는 중…";
        self.createRoom(S, pin).catch(function (e) { out.textContent = SA.errText(e); });
      };
    }
    render();
  };

  T.createRoom = function (S, pin) {
    var self = this;
    if (!this.opts.demo) SA.store.set(LKEY_LAST, { settings: S, savedAt: Date.now() });
    return this.be.tCreate(pin, S, SA.seatsFromSettings(S)).then(function (r) {
      return self.be.tState(r.code, r.token).then(function (st) { self.enter({ code: r.code, token: r.token }, st); });
    });
  };

  T.saveSetup = function (S) {
    var self = this;
    if (!this.opts.demo) SA.store.set(LKEY_LAST, { settings: S, savedAt: Date.now() });
    return this.be.tSetup(this.sess.code, this.sess.token, S, SA.seatsFromSettings(S)).then(function (st) {
      self.enter(self.sess, st); self.toast("설정을 바꿨어요");
    });
  };

  T.startDemo = function () {
    var self = this, S = SA.defaultSettings();
    // 체험용 교실: 5줄 6칸, 앞·뒤 문 옆 국유지 2자리
    S.studentCount = 26; S.rows = 5; S.cols = 6; S.timer = 60; S.maxSeats = 2; S.startPrice = 0;
    S.cells = ["E", "S", "S", "S", "S", "G",
               "S", "S", "S", "S", "S", "S",
               "S", "S", "S", "S", "S", "S",
               "S", "S", "S", "S", "S", "S",
               "G", "S", "S", "S", "S", "E"];
    S.nums = SA.autoNumber(S.rows, S.cols, S.cells, "br", "row");
    this.be.tCreate("0000", S, SA.seatsFromSettings(S)).then(function (r) {
      self.stopBots = SA.startBots(self.be, r.code, 25);
      if (self.opts.onRoom) self.opts.onRoom(r.code);
      return self.be.tState(r.code, r.token).then(function (st) { self.enter({ code: r.code, token: r.token }, st); });
    });
  };

  /* ---------------- 방 ---------------- */
  T.enter = function (sess, st) {
    this.sess = sess;
    if (!this.opts.demo) SA.store.set(LKEY_SESSION, sess);
    this.view = "room"; 
    this.root.innerHTML = '<div class="tv" data-tv><div class="tv-top" data-top></div><div class="tv-main" data-main></div>' +
      '<div class="tv-bottom" data-bottom></div></div>';
    this.lastMain = this.lastTop = this.lastBottom = "";
    this.setState(st); this.startPoll();
  };
  T.startPoll = function () {
    var self = this; this.stopPoll();
    this._poll = setInterval(function () {
      if (self.busy || !self.sess) return;
      self.be.tState(self.sess.code, self.sess.token).then(function (st) { if (!self.busy) self.setState(st); })
        .catch(function (e) {
          if (e.code === "not_found" || e.code === "bad_token") { self.leave("방이 없어졌어요"); }
        });
    }, POLL);
  };
  T.stopPoll = function () { clearInterval(this._poll); this._poll = null; };
  T.leave = function (msg) {
    this.stopPoll(); SA.store.del(LKEY_SESSION); this.sess = null; this.st = null;
    if (this.stopBots) this.stopBots();
    if (msg) this.toast(msg);
    if (this.opts.demo) { location.href = location.href.split("?")[0]; return; }
    this.renderStart();
  };
  T.save = function (room, students, seats) {
    var self = this; this.busy = true;
    return this.be.tSave(this.sess.code, this.sess.token, room, students, seats)
      .then(function (st) { self.busy = false; self.setState(st); return st; })
      .catch(function (e) { self.busy = false; self.err(e); throw e; });
  };
  T.fresh = function () { return this.be.tState(this.sess.code, this.sess.token); };

  T.setState = function (st) {
    this.st = st; this.clock.sync(st.now);
    if (st.room.phase === "done") return this.renderResults();
    if (this.view !== "room") this.enter(this.sess, st);
    this.render();
  };

  /* 화면용 도우미 */
  T.S = function () { return this.st.room.settings; };
  T.nick = function (no) {
    if (no == null) return "";
    var p = this.st.students.filter(function (s) { return s.no === no; })[0];
    return p ? p.nick : no + "번";
  };
  T.seatMap = function () { var m = {}; this.st.seats.forEach(function (s) { m[s.no] = s; }); return m; };
  T.unit = function () { return esc(this.S().unit || ""); };
  T.seatless = function () {
    var sit = {}; this.st.seats.forEach(function (s) { if (s.sitter != null) sit[s.sitter] = 1; });
    return this.st.students.filter(function (p) { return !sit[p.no]; });
  };
  T.vacant = function () {
    return this.st.seats.filter(function (s) { return s.sitter == null && (s.owner != null || s.gov); });
  };

  /* ---------------- 그리기 ---------------- */
  T.render = function () {
    if (this.view !== "room" || !this.st) return;
    var top = this.topHTML(), main = this.mainHTML(), bottom = this.bottomHTML();
    var q = this.root.querySelector.bind(this.root);
    if (top !== this.lastTop) { q("[data-top]").innerHTML = top; this.lastTop = top; }
    if (main !== this.lastMain) {
      // 열려 있는 작은 창은 같은 단계라면 그대로 둠 (화면이 새로 그려져도 닫히지 않게)
      var keep = this.pop && this.popPhase === this.st.room.phase + this.st.room.round ? this.pop : null;
      if (!keep) this.closePop();
      q("[data-main]").innerHTML = main; this.lastMain = main;
      if (keep) q("[data-main]").appendChild(keep);
      this.bindMain(); this.fit(); this.drawQR();
    }
    if (bottom !== this.lastBottom) { q("[data-bottom]").innerHTML = bottom; this.lastBottom = bottom; this.bindBottom(); }
    this.tick();
    if (this.overlay) this.renderManage();
  };

  T.phaseLabel = function () {
    var r = this.st.room;
    return { lobby: "대기실", bidding: r.round + "차 · 입찰 중", closed: r.round + "차 · 마감", revealed: r.round + "차 · 공개",
             ending: "경매 종료", seatpick: "자리 고르기", rent: "임대" }[r.phase] || "";
  };

  T.topHTML = function () {
    var r = this.st.room, n = +r.settings.studentCount, studs = this.st.students, pills = [];
    if (r.phase === "lobby") {
      pills.push("접속 " + studs.length + " / " + n);
      pills.push("입력 " + studs.filter(function (p) { return p.assets != null; }).length + " / " + n);
    } else if (r.phase === "bidding" || r.phase === "closed") {
      var who = {}; this.st.bids.forEach(function (b) { who[b.no] = 1; });
      pills.push("제출 " + Object.keys(who).length + " / " + studs.length);
    } else if (r.phase === "revealed") {
      var ties = this.st.seats.filter(function (s) { return s.tie; }).length;
      if (ties) pills.push("동점 " + ties);
    } else if (r.phase === "seatpick") {
      var multi = this.multiOwners();
      pills.push("자리 선택 " + multi.filter(function (m) { return m.picked; }).length + " / " + multi.length);
    } else if (r.phase === "rent") {
      pills.push("남은 자리 " + this.vacant().length);
      pills.push("자리 없는 학생 " + this.seatless().length);
    }
    return '<div class="tv-phase">' + esc(this.phaseLabel()) + '</div>' +
      pills.map(function (p) { return '<div class="tv-pill">' + esc(p) + '</div>'; }).join("") +
      '<div class="tv-spacer"></div>' +
      (r.phase === "bidding" && r.deadline ? '<div class="tv-timer" data-timer></div>' : "") +
      '<div class="tv-code">방 ' + esc(r.code) + ' · 24시간 후 자동 삭제</div>';
  };

  T.multiOwners = function () {
    var by = {};
    this.st.seats.forEach(function (s) { if (s.owner != null) (by[s.owner] = by[s.owner] || []).push(s); });
    var pres = {}; this.st.seats.forEach(function (s) { if (s.gov && s.sitter != null) pres[s.sitter] = 1; });
    return Object.keys(by).filter(function (k) { return by[k].length > 1 && !pres[k]; }).map(function (k) {
      return { no: +k, seats: by[k], picked: by[k].some(function (s) { return s.sitter === +k; }) };
    });
  };

  T.counting = function () {
    var r = this.st.room;
    return r.phase === "revealed" && !!r.reveal_at && this.clock.left(r.reveal_at) > 0;
  };
  T.mainHTML = function () {
    var r = this.st.room;
    if (r.phase === "lobby") return this.lobbyHTML();
    var html = this.mapHTML() + '<!--' + this.counting() + '-->';
    if (r.phase === "revealed" && !this.counting() && !this.st.seats.some(function (s) { return s.tie; })) {
      var info = (r.meta.rounds || {})[r.round];
      if (info && !info.bids) html += '<div class="banner">이번 차수 입찰이 없었어요</div>';
    }
    return html;
  };

  T.lobbyHTML = function () {
    var r = this.st.room, n = +r.settings.studentCount, by = {};
    this.st.students.forEach(function (p) { by[p.no] = p; });
    var url = SA.studentUrl(r.code), chips = "";
    for (var i = 1; i <= n; i++) {
      var p = by[i];
      chips += '<div class="chip' + (p ? (p.assets != null ? " ready" : " on") + " click" : "") + '"' + (p ? ' data-chip="' + i + '"' : "") + '>' +
        '<span class="n">' + i + '</span>' + (p ? '<span class="nm">' + esc(p.nick) + '</span>' : "") + '</div>';
    }
    return '<div class="lobby"><div class="lobby-head">' +
      '<div class="lobby-code"><span class="k">방 코드</span><span class="v">' + esc(r.code) + '</span>' +
      (this.be.kind === "demo" ? '<span class="u">체험 모드 · 오른쪽 학생 화면에서 입장해 보세요</span>' : '<span class="u">' + esc(url) + '</span>') + '</div>' +
      (this.be.kind === "demo" ? "" : '<div class="qr" data-qr="' + esc(url) + '"></div>') +
      '</div><div class="chips" data-chips style="--n:' + n + '">' + chips + '</div></div>';
  };

  T.mapHTML = function () {
    var self = this, r = this.st.room, S = r.settings, rows = S.rows, cols = S.cols;
    var at = {}; this.st.seats.forEach(function (s) { at[s.r * cols + s.c] = s; });
    var cells = "";
    for (var i = 0; i < rows * cols; i++) cells += at[i] ? this.seatHTML(at[i]) : '<div class="seat gap"></div>';
    var desk = '<div class="desk">교 탁</div>';
    var flipNow = r.phase === "revealed" && !this.flipDone[r.round];
    if (flipNow) setTimeout(function () { self.flipDone[r.round] = true; }, 1200);
    this._flip = flipNow;
    return '<div class="map" data-map>' + (S.deskPos === "top" ? desk : "") +
      '<div class="map-grid" style="grid-template-columns:repeat(' + cols + ',auto)">' + cells + '</div>' +
      (S.deskPos !== "top" ? desk : "") + '</div>';
  };

  T.seatHTML = function (s) {
    var r = this.st.room, ph = r.phase, S = r.settings, u = this.unit(), gn = esc(S.govName || "국유지");
    var no = '<span class="no">' + s.no + '</span>';
    var attrs = ' data-seat="' + s.no + '"';
    // 3·2·1 동안은 이번 차수 결과를 감춤
    if (this.counting() && !s.gov && (s.tie || (s.owner != null && s.won_round === r.round))) return '<div class="seat"' + attrs + '>' + no + '</div>';
    if (s.gov) {
      if (ph === "rent" && s.sitter == null) {
        return '<div class="seat gov has click need"' + attrs + '>' + no + '<span class="tag">' + gn + '</span>' +
          '<div class="lines"><span>임대료 <b>' + (s.rent != null ? num(s.rent) : "") + '</b></span><span>임차인 <b>[&nbsp;&nbsp;&nbsp;]</b></span></div></div>';
      }
      if (ph === "rent" && s.sitter != null) {
        return '<div class="seat gov has click"' + attrs + '>' + no + '<span class="tag">' + gn + '</span>' +
          '<span class="who">' + esc(this.nick(s.sitter)) + '</span><div class="lines"><span>임대료 <b>' + (s.rent != null ? num(s.rent) : "-") + '</b></span></div></div>';
      }
      return '<div class="seat gov' + (s.sitter != null ? " has" : "") + '"' + attrs + '>' + no + '<span class="tag">' + gn + '</span>' +
        (s.sitter != null ? '<span class="who">' + esc(this.nick(s.sitter)) + '</span>' : "") + '</div>';
    }
    if (s.tie) {
      var c = s.tie.cands.map(this.nick.bind(this)).join(" · ");
      return '<div class="seat tie has"' + attrs + '>' + no + '<span class="tag">동점</span><span class="amt">' + num(s.tie.amount) + '</span>' +
        '<span class="cands">' + esc(c) + '</span></div>';
    }
    if (s.owner != null) {
      var flip = this._flip && s.won_round === r.round ? " flip" : "";
      var tied = s.tied ? '<span class="tag">동점</span>' : "";
      if (ph === "rent" && s.sitter !== s.owner) {
        return '<div class="seat rentable has click' + (s.sitter == null ? " need" : "") + '"' + attrs + '>' + no +
          '<span class="who" style="font-size:calc(var(--cell)*.2)">' + esc(this.nick(s.owner)) + '</span>' +
          '<div class="lines"><span>낙찰가 <b>' + num(s.price) + '</b></span><span>임대료 <b>' + (s.rent != null ? num(s.rent) : "") + '</b></span>' +
          '<span>임차인 <b>' + (s.sitter != null ? esc(this.nick(s.sitter)) : "[&nbsp;&nbsp;&nbsp;]") + '</b></span></div></div>';
      }
      var sat = ph === "seatpick" && s.sitter === s.owner ? '<span class="tag">앉음</span>' : tied;
      return '<div class="seat sold has' + flip + '"' + attrs + '>' + no + sat + '<span class="who">' + esc(this.nick(s.owner)) + '</span>' +
        '<span class="amt">' + num(s.price) + '<small style="font-size:.6em;opacity:.8"> ' + u + '</small></span></div>';
    }
    // 아직 주인이 없는 자리
    if (ph === "ending") {
      var ch = this.endChoice[s.no] || "gov";
      return '<div class="seat unsold click' + (ch === "gov" ? " gov" : "") + '"' + attrs + ' style="opacity:1">' + no +
        '<span class="tag">' + (ch === "gov" ? gn : "비움") + '</span></div>';
    }
    if (ph === "revealed") return '<div class="seat unsold"' + attrs + '>' + no + '<span class="tag">유찰</span></div>';
    if (ph === "seatpick" || ph === "rent") return '<div class="seat unsold"' + attrs + '>' + no + '<span class="tag">비움</span></div>';
    return '<div class="seat"' + attrs + '>' + no + '</div>';
  };

  /* 자리표를 화면에 꽉 차게 */
  T.fit = function () {
    if (this.view !== "room" || !this.st) return;
    var main = this.root.querySelector("[data-main]"); if (!main) return;
    var tv = this.root.querySelector("[data-tv]");
    var W0 = main.clientWidth - 24, H0 = main.clientHeight - 24;
    var fsTop = Math.max(16, Math.min(34, Math.min(tv.clientWidth / 48, tv.clientHeight / 26)));
    tv.style.setProperty("--fs-top", fsTop + "px");
    var S = this.st.room.settings;
    if (this.st.room.phase === "lobby") {
      var n = +S.studentCount, chips = main.querySelector("[data-chips]"); if (!chips) return;
      var head = main.querySelector(".lobby-head"), ch = H0 - (head ? head.offsetHeight : 0) - 20;
      var best = { c: 6, w: 100, h: 40 };
      for (var c = 3; c <= 10; c++) {
        var rws = Math.ceil(n / c), w = (W0 - (c - 1) * 10) / c, h = Math.min((ch - (rws - 1) * 10) / rws, w * 0.42);
        if (h > best.h || (best.c === 6 && c === 6)) { if (h >= best.h) best = { c: c, w: w, h: h }; }
      }
      chips.style.gridTemplateColumns = "repeat(" + best.c + "," + Math.floor(best.w) + "px)";
      chips.style.gridAutoRows = Math.floor(best.h) + "px";
      chips.style.setProperty("--chip-fs", Math.max(14, Math.min(46, best.h * 0.5)) + "px");
      return;
    }
    var map = main.querySelector("[data-map]"); if (!map) return;
    var aspect = this.st.room.phase === "rent" ? 1.25 : 1.3;
    var gap = 0.09, deskH = 0.45;
    var byW = W0 / (S.cols * aspect + (S.cols - 1) * gap);
    var byH = H0 / (S.rows + (S.rows - 1) * gap + deskH + 0.12);
    var cell = Math.max(36, Math.floor(Math.min(byW, byH)));
    map.style.setProperty("--cell", cell + "px");
    map.style.setProperty("--aspect", aspect);
  };

  T.drawQR = function () {
    var el = this.root.querySelector("[data-qr]"); if (!el || el.firstChild) return;
    var url = el.dataset.qr, size = Math.max(110, Math.min(220, this.root.clientHeight * 0.2));
    function draw() {
      try { el.innerHTML = ""; new W.QRCode(el, { text: url, width: size, height: size, correctLevel: W.QRCode.CorrectLevel.M }); }
      catch (e) { el.remove(); }
    }
    if (W.QRCode) return draw();
    if (SA._qrLoading) return SA._qrLoading.then(draw, function () { el.remove(); });
    SA._qrLoading = new Promise(function (res, rej) {
      var s = document.createElement("script");
      s.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
    SA._qrLoading.then(draw, function () { el.remove(); });
  };

  T.bottomHTML = function () {
    var r = this.st.room, ph = r.phase, b = [];
    var mg = '<button class="btn ghost" data-b="manage">관리</button><button class="btn ghost" data-b="full">전체 화면</button>';
    if (ph === "lobby") {
      b.push('<button class="btn lg pri" data-b="start"' + (this.st.students.length ? "" : " disabled") + '>1차 시작</button>');
      b.push('<button class="btn lg" data-b="setup">설정 수정</button>');
      b.push('<span class="tv-msg">학생 칸을 누르면 내보낼 수 있어요</span>');
    } else if (ph === "bidding") {
      b.push('<button class="btn lg pri" data-b="close">지금 마감</button>');
      if (r.deadline) b.push('<button class="btn lg" data-b="plus">+30초</button>');
    } else if (ph === "closed") {
      b.push('<button class="btn lg pri" data-b="reveal">공개</button>');
    } else if (ph === "revealed") {
      var ties = this.st.seats.filter(function (s) { return s.tie; });
      if (ties.length) {
        if (r.settings.tieMode === "teacher") b.push('<span class="tv-msg">동점 자리를 눌러 낙찰자를 고르세요</span>');
        else { b.push('<button class="btn lg pri" data-b="drawall">모두 추첨</button>'); b.push('<span class="tv-msg">동점 자리를 눌러 하나씩 추첨할 수도 있어요</span>'); }
      } else {
        var why = SA.endReason(this.st);
        if (why) { b.push('<button class="btn lg pri" data-b="end">경매 마치기</button>'); b.push('<span class="tv-msg">' + esc(why) + '</span>'); }
        else { b.push('<button class="btn lg pri" data-b="next">' + (r.round + 1) + '차 시작</button>'); b.push('<button class="btn lg" data-b="price">시작가 ' + num(+r.settings.startPrice || 0) + '</button>'); b.push('<button class="btn lg" data-b="endq">경매 종료</button>'); }
      }
    } else if (ph === "ending") {
      b.push('<button class="btn lg pri" data-b="ending">다음</button>');
      b.push('<span class="tv-msg">남은 자리를 눌러 ' + esc(r.settings.govName) + ' / 비움을 바꾸세요</span>');
    } else if (ph === "seatpick") {
      b.push('<button class="btn lg pri" data-b="picked">다음</button>');
      b.push('<span class="tv-msg">여러 자리를 가진 학생이 앉을 자리를 고르는 중 · 안 고르면 가장 비싼 자리</span>');
    } else if (ph === "rent") {
      b.push('<button class="btn lg pri" data-b="done">결과 보기</button>');
      b.push('<span class="tv-msg">노란 테두리 자리를 눌러 임차인 정하기</span>');
    }
    return b.join("") + '<div class="tv-spacer"></div>' + mg;
  };

  T.bindBottom = function () {
    var self = this;
    this.root.querySelectorAll("[data-b]").forEach(function (btn) {
      btn.onclick = function () { self.act(btn.dataset.b, btn); };
    });
  };
  T.bindMain = function () {
    var self = this, ph = this.st.room.phase;
    this.root.querySelectorAll("[data-chip]").forEach(function (el) {
      el.onclick = function () { self.chipPop(+el.dataset.chip, el); };
    });
    this.root.querySelectorAll("[data-seat]").forEach(function (el) {
      el.onclick = function () {
        var s = self.seatMap()[+el.dataset.seat]; if (!s) return;
        if (ph === "revealed" && s.tie) self.tiePop(s, el);
        else if (ph === "ending" && !s.gov && s.owner == null) { self.endChoice[s.no] = (self.endChoice[s.no] || "gov") === "gov" ? "empty" : "gov"; self.lastMain = ""; self.render(); }
        else if (ph === "rent" && (s.gov || (s.owner != null && s.sitter !== s.owner))) self.rentPop(s, el);
      };
    });
  };

  /* 시계: 타이머·자동 마감·카운트다운 */
  T.tick = function () {
    if (this.view !== "room" || !this.st) return;
    var r = this.st.room, tv = this.root.querySelector("[data-tv]"); if (!tv) return;
    var tEl = this.root.querySelector("[data-timer]");
    if (r.phase === "bidding" && r.deadline) {
      var left = this.clock.left(r.deadline);
      if (tEl) { tEl.textContent = SA.mmss(left); tEl.classList.toggle("hot", left <= 10000); }
      if (left <= 0 && !this.busy && !this._closing) {
        var self = this; this._closing = true;
        this.save({ phase: "closed" }).then(function () { self._closing = false; }, function () { self._closing = false; });
      }
    }
    var cd = tv.querySelector(".count");
    if (r.phase === "revealed" && r.reveal_at) {
      var ms = this.clock.left(r.reveal_at);
      if (ms > 0) {
        var n = Math.min(3, Math.ceil(ms / 1000));
        if (!cd) { cd = SA.h("div", { class: "count" }); tv.appendChild(cd); }
        if (cd.dataset.n !== String(n)) { cd.dataset.n = n; cd.innerHTML = "<span>" + n + "</span>"; }
        return;
      }
    }
    if (cd) { cd.remove(); this.flipDone[r.round] = false; this.lastMain = ""; this.render(); }
  };

  /* ---------------- 진행 ---------------- */
  T.act = function (a, btn) {
    var self = this, r = this.st.room, S = r.settings;
    if (a === "manage") { this.overlay = true; return this.renderManage(); }
    if (a === "full") {
      var el = this.opts.demo ? this.root : document.documentElement;
      if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen();
      return;
    }
    if (a === "start" || a === "next") {
      return this.save({ phase: "bidding", round: r.round + 1, deadline_in: +S.timer > 0 ? +S.timer : null, reveal_in: null });
    }
    if (a === "close") return this.save({ phase: "closed" });
    if (a === "plus") return this.save({ deadline_add: 30 });
    if (a === "reveal") return this.reveal();
    if (a === "drawall") {
      var seats = [], studs = {}, tied = this.st.seats.filter(function (s) { return s.tie; });
      tied.forEach(function (s) { var w = SA.pick(s.tie.cands); self.tiePatch(s, w, seats, studs); });
      return this.save({}, this.studPatch(studs), seats);
    }
    if (a === "price") return this.pricePop(btn);
    if (a === "setup") { this.overlay = false; return this.renderSetup(S, true); }
    if (a === "endq") return SA.arm(btn, "한 번 더 누르면 종료", function () { self.goEnding(); });
    if (a === "end") return this.goEnding();
    if (a === "ending") return this.afterEnding();
    if (a === "picked") return this.goRent();
    if (a === "done") {
      var left = this.seatless().length;
      if (left) return SA.arm(btn, "자리 없는 학생 " + left + "명 · 그래도 결과 보기", function () { self.save({ phase: "done" }); });
      return this.save({ phase: "done" });
    }
  };

  T.reveal = function () {
    var self = this;
    this.busy = true;
    return this.fresh().then(function (st) {
      self.busy = false; self.st = st;
      var r = st.room, res = SA.resolve(st.seats, st.bids), seats = [], spend = {};
      res.wins.forEach(function (w) {
        seats.push({ no: w.seat, owner: w.no, price: w.amount, won_round: r.round });
        spend[w.no] = (spend[w.no] || 0) + w.amount;
      });
      res.ties.forEach(function (t) { seats.push({ no: t.seat, tie: { amount: t.amount, cands: t.cands } }); });
      var who = {}; st.bids.forEach(function (b) { who[b.no] = 1; });
      var meta = JSON.parse(JSON.stringify(r.meta || {}));
      meta.rounds = meta.rounds || {};
      meta.rounds[r.round] = { bidders: Object.keys(who).length, bids: st.bids.length,
                               open: res.wins.length + res.ties.length + res.unsold.length };
      var studs = {}; Object.keys(spend).forEach(function (k) { studs[k] = -spend[k]; });
      self.flipDone[r.round] = false;
      return self.save({ phase: "revealed", reveal_in: 3.6, meta: meta }, self.studPatch(studs), seats);
    }, function (e) { self.busy = false; self.err(e); });
  };
  // studs: {no: 더할 금액}
  T.studPatch = function (studs) {
    var by = {}; this.st.students.forEach(function (p) { by[p.no] = p; });
    return Object.keys(studs).filter(function (k) { return by[k]; }).map(function (k) {
      return { no: +k, assets: Math.max(0, (by[k].assets || 0) + studs[k]) };
    });
  };
  T.tiePatch = function (s, winner, seats, studs) {
    seats.push({ no: s.no, owner: winner, price: s.tie.amount, won_round: this.st.room.round, tie: null,
                 tied: { amount: s.tie.amount, cands: s.tie.cands, winner: winner } });
    studs[winner] = (studs[winner] || 0) - s.tie.amount;
  };

  T.goEnding = function () {
    var self = this, open = this.st.seats.filter(SA.isOpenSeat);
    this.endChoice = {};
    if (!open.length) return this.save({ phase: "ending", deadline_in: null }).then(function () { return self.afterEnding(); });
    open.forEach(function (s) { self.endChoice[s.no] = "gov"; });
    return this.save({ phase: "ending", deadline_in: null });
  };

  // 남은 자리 처리 → 한 자리 주인은 그 자리에 앉힘 → 여러 자리 주인이 있으면 자리 고르기
  T.afterEnding = function () {
    var self = this, seats = [], local = this.st.seats.map(function (s) { return Object.assign({}, s); });
    local.forEach(function (s) {
      if (SA.isOpenSeat(s) && self.endChoice[s.no] !== "empty") { s.gov = true; seats.push({ no: s.no, gov: true }); }
    });
    var by = {}, pres = {};
    local.forEach(function (s) {
      if (s.owner != null) (by[s.owner] = by[s.owner] || []).push(s);
      if (s.gov && s.sitter != null) pres[s.sitter] = 1;
    });
    var multi = false;
    Object.keys(by).forEach(function (k) {
      if (pres[k]) return;
      if (by[k].length === 1) { var s = by[k][0]; if (s.sitter == null) { s.sitter = +k; seats.push({ no: s.no, sitter: +k }); } }
      else multi = true;
    });
    if (multi) return this.save({ phase: "seatpick" }, [], seats);
    return this.goRent(local, seats);
  };

  // 안 고른 사람 정리 → 끝까지 입찰 안 한 학생 배정 → 임대
  T.goRent = function (local, seats) {
    var self = this;
    local = local || this.st.seats.map(function (s) { return Object.assign({}, s); });
    seats = seats || [];
    var by = {}, pres = {};
    local.forEach(function (s) {
      if (s.owner != null) (by[s.owner] = by[s.owner] || []).push(s);
      if (s.gov && s.sitter != null) pres[s.sitter] = 1;
    });
    Object.keys(by).forEach(function (k) {
      if (pres[k]) return;
      var mine = by[k];
      if (mine.some(function (s) { return s.sitter === +k; })) return;
      var best = mine.filter(function (s) { return s.sitter == null; }).sort(function (a, b) { return (b.price || 0) - (a.price || 0); })[0];
      if (best) { best.sitter = +k; seats.push({ no: best.no, sitter: +k }); }
    });
    var mode = this.st.room.settings.nonPart;
    if (mode !== "teacher") {
      var sit = {}; local.forEach(function (s) { if (s.sitter != null) sit[s.sitter] = 1; });
      var lazy = SA.shuffle(this.st.students.filter(function (p) { return !sit[p.no] && !p.bid_any; }));
      var vac = function (g) { return local.filter(function (s) { return s.sitter == null && (g ? s.gov : s.owner != null); }); };
      var pool = mode === "gov" ? SA.shuffle(vac(true)).concat(SA.shuffle(vac(false))) : SA.shuffle(vac(true).concat(vac(false)));
      lazy.forEach(function (p) {
        var s = pool.shift(); if (!s) return;
        s.sitter = p.no; seats.push({ no: s.no, sitter: p.no });
      });
    }
    var vacant = local.filter(function (s) { return s.sitter == null && (s.owner != null || s.gov); }).length;
    var sitNow = {}; local.forEach(function (s) { if (s.sitter != null) sitNow[s.sitter] = 1; });
    var homeless = this.st.students.filter(function (p) { return !sitNow[p.no]; }).length;
    var anyRent = local.some(function (s) { return s.sitter != null && (s.gov || (s.owner != null && s.owner !== s.sitter)); });
    var next = (vacant || homeless || anyRent) ? "rent" : "done";
    return this.save({ phase: next }, [], seats);
  };

  /* ---------------- 작은 창 ---------------- */
  T.closePop = function () { if (this.pop) { this.pop.remove(); this.pop = null; } };
  T.openPop = function (anchor, html) {
    this.closePop();
    var main = this.root.querySelector("[data-main]");
    var p = SA.h("div", { class: "pop" }, '<button class="pop-x" aria-label="닫기">×</button>' + html);
    main.appendChild(p); this.pop = p; this.popPhase = this.st.room.phase + this.st.room.round;
    var a = anchor.getBoundingClientRect(), m = main.getBoundingClientRect();
    var x = a.left - m.left + a.width / 2 - p.offsetWidth / 2, y = a.bottom - m.top + 8;
    if (y + p.offsetHeight > m.height) y = Math.max(8, a.top - m.top - p.offsetHeight - 8);
    p.style.left = Math.max(8, Math.min(m.width - p.offsetWidth - 8, x)) + "px"; p.style.top = y + "px";
    var self = this; p.querySelector(".pop-x").onclick = function () { self.closePop(); };
    return p;
  };
  T.chipPop = function (no, el) {
    var self = this, p = this.openPop(el, '<h3>' + no + '번 · ' + esc(this.nick(no)) + '</h3><div class="row"><button class="btn" data-k>내보내기</button></div>');
    p.querySelector("[data-k]").onclick = function () {
      var b = this; SA.arm(b, "한 번 더 누르면 내보내기", function () { self.closePop(); self.save({}, [{ no: no, remove: true }], []); });
    };
  };
  T.tiePop = function (s, el) {
    var self = this, auto = this.st.room.settings.tieMode !== "teacher";
    var body = '<h3>' + s.no + '번 동점 · ' + num(s.tie.amount) + ' ' + this.unit() + '</h3><div class="row">' +
      (auto ? '<button class="btn lg pri" data-draw>추첨</button>'
            : s.tie.cands.map(function (c) { return '<button class="btn lg" data-w="' + c + '">' + esc(self.nick(c)) + '</button>'; }).join("")) + '</div>';
    var p = this.openPop(el, body);
    function go(w) {
      var seats = [], studs = {}; self.tiePatch(s, w, seats, studs); self.closePop();
      self.save({}, self.studPatch(studs), seats).then(function () { self.toast(s.no + "번 · " + self.nick(w)); });
    }
    if (auto) p.querySelector("[data-draw]").onclick = function () { go(SA.pick(s.tie.cands)); };
    else p.querySelectorAll("[data-w]").forEach(function (b) { b.onclick = function () { go(+b.dataset.w); }; });
  };
  T.pricePop = function (btn) {
    var self = this, S = this.S();
    var p = this.openPop(btn, '<h3>다음 차수 시작가 (' + this.unit() + ')</h3><div class="row"><input class="input" data-sp inputmode="numeric" style="width:160px" value="' + (+S.startPrice || 0) + '">' +
      '<button class="btn pri" data-ok>저장</button></div>');
    var inp = p.querySelector("[data-sp]"); inp.focus(); inp.select();
    p.querySelector("[data-ok]").onclick = function () {
      var v = Math.max(0, Math.round(+inp.value.replace(/[,\s]/g, "") || 0));
      var ns = JSON.parse(JSON.stringify(S)); ns.startPrice = v;
      self.closePop(); self.save({ settings: ns }).then(function () { self.toast("시작가 " + num(v)); });
    };
  };
  T.rentPop = function (s, el) {
    var self = this, gn = esc(this.st.room.settings.govName);
    var homeless = this.seatless();
    var title = s.no + "번 · " + (s.gov ? gn : "임대인 " + esc(this.nick(s.owner)));
    var body = '<h3>' + title + '</h3>' +
      '<div class="lbl">임대료' + (s.gov ? "" : (s.rent == null ? " · 임대인이 아직 안 넣었어요 (대신 넣기)" : "")) + '</div>' +
      '<div class="row"><input class="input" data-rent inputmode="numeric" style="width:160px" value="' + (s.rent != null ? s.rent : "") + '">' +
      '<button class="btn" data-saverent>저장</button></div>' +
      '<div class="lbl">임차인</div><div class="row">' +
      (homeless.length ? homeless.map(function (p) { return '<button class="btn" data-t="' + p.no + '">' + p.no + ' ' + esc(p.nick) + '</button>'; }).join("") : '<span class="tv-msg">자리 없는 학생이 없어요</span>') +
      (s.sitter != null ? '<button class="btn" data-clear>' + esc(this.nick(s.sitter)) + ' 빼기</button>' : "") + '</div>';
    var p = this.openPop(el, body);
    var rentVal = function () { var v = p.querySelector("[data-rent]").value.trim(); return v === "" ? null : Math.max(0, +v || 0); };
    p.querySelector("[data-saverent]").onclick = function () { self.closePop(); self.save({}, [], [{ no: s.no, rent: rentVal() }]); };
    p.querySelectorAll("[data-t]").forEach(function (b) {
      b.onclick = function () { self.closePop(); self.save({}, [], [{ no: s.no, sitter: +b.dataset.t, rent: rentVal() }]); };
    });
    var c = p.querySelector("[data-clear]"); if (c) c.onclick = function () { self.closePop(); self.save({}, [], [{ no: s.no, sitter: null }]); };
  };

  /* ---------------- 관리 ---------------- */
  T.renderManage = function () {
    var self = this, tv = this.root.querySelector("[data-tv]"); if (!tv) return;
    var ov = tv.querySelector(".overlay");
    if (!ov) { ov = SA.h("div", { class: "overlay" }); tv.appendChild(ov); }
    var st = this.st, r = st.room, u = this.unit(), seats = st.seats;
    var canEdit = r.phase === "lobby" || r.phase === "revealed";
    var bidsBy = {}; st.bids.forEach(function (b) { (bidsBy[b.no] = bidsBy[b.no] || []).push(b.seat + "번 " + num(b.amount)); });
    var showBids = r.phase === "bidding" || r.phase === "closed" || r.phase === "revealed";
    var own = {}; seats.forEach(function (s) { if (s.owner != null) (own[s.owner] = own[s.owner] || []).push(s.no); });
    var focus = document.activeElement && ov.contains(document.activeElement) ? document.activeElement.dataset.as : null;
    if (focus) return; // 입력 중에는 다시 그리지 않음
    ov.innerHTML = '<div class="page"><div class="row" style="justify-content:space-between;margin-bottom:10px">' +
      '<h1 style="margin:0">관리</h1><button class="btn pri" data-x>닫기</button></div>' +
      '<p class="lead">TV에 보이는 화면 · 다른 기기: 이어하기 → 방 ' + esc(r.code) + '</p>' +
      '<div class="card"><h2>학생 (' + st.students.length + '명)</h2><div class="tablewrap"><table class="tbl"><thead><tr>' +
      '<th>번호</th><th>별명</th><th class="n">보유 자산 (' + u + ')</th>' + (showBids ? '<th>이번 차수 입찰</th>' : "") + '<th>가진 자리</th><th></th></tr></thead><tbody>' +
      st.students.map(function (p) {
        return '<tr><td>' + p.no + '</td><td><b>' + esc(p.nick) + '</b></td>' +
          '<td class="n">' + (canEdit ? '<input class="input" style="width:120px;text-align:right" data-as="' + p.no + '" value="' + (p.assets == null ? "" : p.assets) + '">' : num(p.assets)) + '</td>' +
          (showBids ? '<td>' + esc((bidsBy[p.no] || []).join(" · ")) + '</td>' : "") +
          '<td>' + esc((own[p.no] || []).map(function (n) { return n + "번"; }).join(", ")) + '</td>' +
          '<td><button class="btn" data-kick="' + p.no + '" style="min-height:36px;padding:6px 12px">내보내기</button></td></tr>';
      }).join("") + '</tbody></table></div>' +
      (canEdit ? '<p class="note">보유 자산은 대기실과 차수 사이(공개 화면)에서만 고칠 수 있어요. 칸을 바꾸면 바로 저장돼요.</p>' : "") + '</div>' +
      '<div class="card"><h2>경매 기록</h2>' + this.logTable() + '</div></div>';
    ov.querySelector("[data-x]").onclick = function () { self.overlay = false; ov.remove(); };
    ov.querySelectorAll("[data-as]").forEach(function (inp) {
      inp.onchange = function () {
        var v = Math.max(0, Math.round(+inp.value || 0));
        inp.blur(); self.save({}, [{ no: +inp.dataset.as, assets: v }], []);
      };
    });
    ov.querySelectorAll("[data-kick]").forEach(function (b) {
      b.onclick = function () { SA.arm(b, "한 번 더", function () { self.save({}, [{ no: +b.dataset.kick, remove: true }], []); }); };
    });
  };

  T.logRows = function () {
    var st = this.st, rounds = (st.room.meta && st.room.meta.rounds) || {};
    return Object.keys(rounds).map(Number).sort(function (a, b) { return a - b; }).map(function (rn) {
      var info = rounds[rn], won = st.seats.filter(function (s) { return s.won_round === rn; });
      var prices = won.map(function (s) { return s.price || 0; });
      var max = prices.length ? Math.max.apply(null, prices) : null;
      var avg = prices.length ? Math.round(prices.reduce(function (a, b) { return a + b; }, 0) / prices.length) : null;
      return { round: rn, bidders: info.bidders, sold: won.length, unsold: Math.max(0, (info.open || 0) - won.length),
               ties: won.filter(function (s) { return s.tied; }).length, max: max, avg: avg };
    });
  };
  T.logTable = function () {
    var rows = this.logRows();
    if (!rows.length) return '<p class="note">아직 공개한 차수가 없어요</p>';
    return '<div class="tablewrap"><table class="tbl"><thead><tr><th>차수</th><th class="n">입찰 학생</th><th class="n">낙찰</th><th class="n">유찰</th>' +
      '<th class="n">동점</th><th class="n">최고가</th><th class="n">평균가</th></tr></thead><tbody>' +
      rows.map(function (x) {
        return '<tr><td>' + x.round + '차</td><td class="n">' + x.bidders + '</td><td class="n">' + x.sold + '</td><td class="n">' + x.unsold + '</td>' +
          '<td class="n">' + x.ties + '</td><td class="n">' + num(x.max) + '</td><td class="n">' + num(x.avg) + '</td></tr>';
      }).join("") + '</tbody></table></div>';
  };

  /* ---------------- 결과 ---------------- */
  T.renderResults = function () {
    var self = this, st = this.st, S = st.room.settings, u = esc(S.unit), gn = esc(S.govName);
    if (this.view !== "results") { this.view = "results"; this.resTab = this.resTab || "map"; this.detail = this.detail || false; }
    var focusKeep = this.root.querySelector("[data-results]") && this._resHash === JSON.stringify([st.seats, st.students, this.resTab, this.detail]);
    if (focusKeep) return;
    this._resHash = JSON.stringify([st.seats, st.students, this.resTab, this.detail]);
    var by = {}; st.students.forEach(function (p) { by[p.no] = p; });
    var nk = function (n) { return n == null ? "" : (by[n] ? by[n].nick : n + "번"); };

    // 정산표
    var settle = st.students.map(function (p) {
      var mine = st.seats.filter(function (s) { return s.owner === p.no; });
      var spent = mine.reduce(function (a, s) { return a + (s.price || 0); }, 0);
      return { no: p.no, nick: p.nick, seats: mine.map(function (s) { return s.no; }), spent: spent, now: p.assets || 0, start: (p.assets || 0) + spent };
    });
    // 임대 목록
    var rents = st.seats.filter(function (s) { return s.sitter != null && (s.gov || (s.owner != null && s.owner !== s.sitter)); })
      .map(function (s) { return { no: s.no, landlord: s.gov ? S.govName : nk(s.owner), tenant: nk(s.sitter), rent: s.rent }; });
    var logs = this.logRows();

    var tab = this.resTab, body = "";
    if (tab === "map") body = '<div class="row no-print" style="margin-bottom:12px"><span class="field" style="flex-direction:row;align-items:center;gap:10px">게시용 자리표' +
        '<div class="seg"><button data-detail="0" aria-pressed="' + !this.detail + '">이름만</button><button data-detail="1" aria-pressed="' + this.detail + '">자세히</button></div></span></div>' +
        this.printMap(nk);
    else if (tab === "settle") body = '<div class="tablewrap"><table class="tbl"><thead><tr><th>번호</th><th>별명</th><th>낙찰 자리</th>' +
        '<th class="n">처음 자산</th><th class="n">낼 금액</th><th class="n">남은 자산</th></tr></thead><tbody>' +
        settle.map(function (x) { return '<tr><td>' + x.no + '</td><td>' + esc(x.nick) + '</td><td>' + x.seats.map(function (n) { return n + "번"; }).join(", ") + '</td>' +
          '<td class="n">' + num(x.start) + '</td><td class="n"><b>' + num(x.spent) + '</b></td><td class="n">' + num(x.now) + '</td></tr>'; }).join("") +
        '</tbody></table></div><p class="note">낼 금액만큼 학급 화폐에서 빼 주세요 · 단위 ' + u + '</p>';
    else if (tab === "rent") body = rents.length ? '<div class="tablewrap"><table class="tbl"><thead><tr><th>자리</th><th>임대인</th><th>임차인</th><th class="n">임대료</th></tr></thead><tbody>' +
        rents.map(function (x) { return '<tr><td>' + x.no + '번</td><td>' + esc(x.landlord) + '</td><td>' + esc(x.tenant) + '</td><td class="n">' + num(x.rent) + '</td></tr>'; }).join("") +
        '</tbody></table></div>' : '<p class="note">임대한 자리가 없어요</p>';
    else body = this.logTable();

    
    this.root.innerHTML = '<div class="page" data-results>' +
      '<div class="no-print"><h1>자리 경매 결과</h1><p class="lead">' + SA.today() + ' · 방 ' + esc(st.room.code) + ' · 24시간 후 자동 삭제</p></div>' +
      '<div class="print-only"><h2>' + SA.today() + ' 자리 경매 · ' + ({ map: "자리표", settle: "정산표", rent: "임대 목록", log: "경매 기록" })[tab] + '</h2></div>' +
      '<div class="tabs no-print">' + [["map", "자리표"], ["settle", "정산표"], ["rent", "임대 목록"], ["log", "경매 기록"]].map(function (t) {
        return '<button data-tab="' + t[0] + '" aria-selected="' + (tab === t[0]) + '">' + t[1] + '</button>'; }).join("") + '</div>' +
      '<div class="card">' + body + '<div class="row no-print" style="margin-top:14px"><button class="btn pri" data-r="print">인쇄</button>' +
        '<button class="btn" data-r="csv">엑셀로 내려받기</button></div></div>' +
      '<div class="card no-print"><h2>다음 달을 위해</h2><div class="row">' +
        '<div><button class="btn" data-r="savelocal">설정 저장</button><div class="note">이 컴퓨터에만 저장 · 인터넷 기록·PC 초기화 시 사라짐</div></div>' +
        '<div><button class="btn" data-r="savefile">설정 파일 내려받기</button><div class="note">다른 컴퓨터에서 불러올 때 사용</div></div></div></div>' +
      '<div class="card no-print"><div class="row"><button class="btn" data-r="back">임대 화면으로 돌아가기</button><div class="tv-spacer" style="flex:1"></div>' +
        '<div><button class="btn danger" data-r="finish">마치기</button><div class="note">모든 기록 즉시 삭제</div></div></div></div>' +
      '</div>';

    var q = function (s) { return self.root.querySelectorAll(s); };
    q("[data-tab]").forEach(function (b) { b.onclick = function () { self.resTab = b.dataset.tab; self.renderResults(); }; });
    q("[data-detail]").forEach(function (b) { b.onclick = function () { self.detail = b.dataset.detail === "1"; self.renderResults(); }; });
    q('[data-r="print"]')[0].onclick = function () { W.print(); };
    q('[data-r="csv"]')[0].onclick = function () {
      var rows, name = "자리경매_" + SA.todayFile() + "_";
      if (tab === "map") { rows = [["자리", "앉은 사람", "주인", "낙찰가", "임대료"]].concat(st.seats.map(function (s) {
        return [s.no, nk(s.sitter), s.gov ? S.govName : nk(s.owner), s.price == null ? "" : s.price, s.rent == null ? "" : s.rent]; })); name += "자리표"; }
      else if (tab === "settle") { rows = [["번호", "별명", "낙찰 자리", "처음 자산", "낼 금액", "남은 자산"]].concat(settle.map(function (x) {
        return [x.no, x.nick, x.seats.join(" "), x.start, x.spent, x.now]; })); name += "정산표"; }
      else if (tab === "rent") { rows = [["자리", "임대인", "임차인", "임대료"]].concat(rents.map(function (x) { return [x.no, x.landlord, x.tenant, x.rent == null ? "" : x.rent]; })); name += "임대목록"; }
      else { rows = [["차수", "입찰 학생", "낙찰", "유찰", "동점", "최고가", "평균가"]].concat(logs.map(function (x) {
        return [x.round, x.bidders, x.sold, x.unsold, x.ties, x.max == null ? "" : x.max, x.avg == null ? "" : x.avg]; })); name += "경매기록"; }
      SA.download(name + ".csv", SA.csv(rows), "text/csv;charset=utf-8");
    };
    q('[data-r="savelocal"]')[0].onclick = function () {
      if (self.opts.demo) return self.toast("체험 모드에서는 저장하지 않아요");
      SA.store.set(LKEY_LAST, { settings: S, savedAt: Date.now() }) ? self.toast("이 컴퓨터에 저장했어요") : self.toast("저장하지 못했어요");
    };
    q('[data-r="savefile"]')[0].onclick = function () {
      SA.download("자리경매설정_" + SA.todayFile() + ".json", JSON.stringify({ app: "seat-auction", v: 1, settings: S }, null, 2), "application/json");
    };
    q('[data-r="back"]')[0].onclick = function () { self.view = "room"; self.save({ phase: "rent" }); };
    q('[data-r="finish"]')[0].onclick = function () {
      var b = this;
      SA.arm(b, "결과를 내려받았나요? 한 번 더", function () {
        self.be.tDelete(self.sess.code, self.sess.token).then(function () { self.leave("모든 기록을 지웠어요"); }, function (e) { self.err(e); });
      });
    };
  };

  T.printMap = function (nk) {
    var st = this.st, S = st.room.settings, detail = this.detail, gn = S.govName;
    var at = {}; st.seats.forEach(function (s) { at[s.r * S.cols + s.c] = s; });
    var w = Math.min(130, Math.floor(900 / S.cols)), h = detail ? Math.round(w * 0.95) : Math.round(w * 0.6);
    var cells = "";
    for (var i = 0; i < S.rows * S.cols; i++) {
      var s = at[i];
      if (!s) { cells += '<div class="pseat gap" style="width:' + w + 'px;height:' + h + 'px"></div>'; continue; }
      var who = s.sitter != null ? nk(s.sitter) : (s.gov ? gn : "");
      var d = "";
      if (detail) {
        var lines = [];
        if (s.gov) { if (s.sitter != null) lines.push(esc(gn)); }
        else if (s.owner != null && s.owner !== s.sitter) lines.push("주인 " + esc(nk(s.owner)));
        if (s.price != null) lines.push("낙찰가 " + num(s.price));
        if (s.sitter != null && (s.gov || s.owner !== s.sitter) && s.rent != null) lines.push("임대료 " + num(s.rent));
        d = '<div class="pd">' + lines.join("<br>") + '</div>';
      }
      cells += '<div class="pseat" style="width:' + w + 'px;height:' + h + 'px"><div class="pn">' + s.no + '</div><div class="pw">' + esc(who) + '</div>' + d + '</div>';
    }
    var desk = '<div class="pdesk">교 탁</div>';
    return '<div class="pmap">' + (S.deskPos === "top" ? desk : "") +
      '<div class="pmap-grid" style="grid-template-columns:repeat(' + S.cols + ',' + w + 'px)">' + cells + '</div>' +
      (S.deskPos !== "top" ? desk : "") + '</div>';
  };
})(window);
