// dsh-eval-defaults client entry (static ModuleLoader bundle).
// Hand-written plain JS: React.createElement only; talks to the host through
// the typert `evalDefaults` Remote namespace. All styling is inline
// (theme tokens via var()) — no style-tag injection, no external classes.
window.__ModuleLoader__.load({
  id: "dsh-eval-defaults",
  factory: function (require) {
    var React = require("react");

    var name = "dsh-eval-defaults";
    var inject = ["slots", "remote"];

    var EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];

    var objectSchema = { parse: function (v) { if (v === null || typeof v !== "object" || Array.isArray(v)) throw new TypeError("expected an object"); return v; } };
    var envelopeSchema = { parse: function (v) { if (v === null || typeof v !== "object" || typeof v.ok !== "boolean") throw new TypeError("expected an { ok, ... } envelope"); return v; } };
    var objectCodec = { mode: "strict", typeSymbol: "dsh-eval-defaults#Object", schema: objectSchema };
    var envelopeCodec = { mode: "strict", typeSymbol: "dsh-eval-defaults#Result", schema: envelopeSchema };
    var objectParam = function (n) { return { name: n, wire: n, source: "json", codec: objectCodec }; };

    var INVOCATIONS = [
      { id: "dsh-eval-defaults#evalDefaults/getState", service: "evalDefaults", namespace: "evalDefaults", method: "getState", invocation: { kind: "direct" }, parameters: [], result: envelopeCodec },
      { id: "dsh-eval-defaults#evalDefaults/setDefaults", service: "evalDefaults", namespace: "evalDefaults", method: "setDefaults", invocation: { kind: "direct" }, parameters: [objectParam("patch")], result: envelopeCodec },
    ];

    // Theme-aware inline styles (tokens resolve in this UI — proven by the
    // Subagent 默认 page's --dsw-alias-* usage).
    var T = {
      page: { display: "flex", flexDirection: "column", gap: 12, maxWidth: 640, padding: "4px 2px 24px", color: "var(--dsw-alias-label-primary)" },
      title: { color: "var(--dsw-alias-label-primary)", fontSize: 16, fontWeight: 500, lineHeight: "24px", margin: 0 },
      hint: { color: "var(--dsw-alias-label-tertiary)", fontSize: 13, lineHeight: "22px", margin: 0 },
      card: { background: "var(--dsw-alias-bg-layer-2)", border: "1px solid var(--dsw-alias-border-l1)", borderRadius: 12, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 12 },
      field: { display: "flex", flexDirection: "column", gap: 6 },
      label: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, lineHeight: "16px" },
      select: { boxSizing: "border-box", width: "100%", height: 32, padding: "0 10px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontFamily: "inherit", fontSize: 13, appearance: "auto" },
      btn: { boxSizing: "border-box", height: 32, padding: "0 14px", borderRadius: 8, border: "1px solid var(--dsw-alias-border-l1)", background: "var(--dsw-alias-bg-base)", color: "var(--dsw-alias-label-primary)", fontFamily: "inherit", fontSize: 13, cursor: "pointer" },
      btnPrimary: { boxSizing: "border-box", height: 32, padding: "0 16px", borderRadius: 8, border: "none", background: "var(--dsw-alias-button-primary-fill)", color: "var(--dsw-alias-label-primary-foreground)", fontFamily: "inherit", fontSize: 13, fontWeight: 500, cursor: "pointer" },
      row: { display: "flex", flexDirection: "row", gap: 8, alignItems: "center" },
      divider: { borderTop: "1px solid var(--dsw-alias-border-l1)", paddingTop: 12, marginTop: 4 },
      statusOk: { color: "var(--dsw-alias-state-success-primary)", fontSize: 13, lineHeight: "20px", margin: 0 },
      statusErr: { color: "var(--dsw-alias-state-error-primary)", fontSize: 13, lineHeight: "20px", margin: 0 },
    };

    function apply(ctx) {
      var remote = null;
      ctx.effect(function () {
        var disposed = false;
        var disposeRemote = null;
        return ctx.remote.$mount({ package: name, descriptors: INVOCATIONS }).then(function (dispose) {
          if (disposed) { void dispose(); return undefined; }
          disposeRemote = dispose;
          var handle = ctx.reflect.get("remote.evalDefaults");
          if (handle === undefined) throw new Error("dsh-eval-defaults: the evalDefaults Remote namespace did not mount");
          remote = handle;
          return function () {
            disposed = true;
            remote = null;
            if (disposeRemote) { void disposeRemote(); disposeRemote = null; }
          };
        });
      }, "dsh-eval-defaults: remote");

      var call = function (method, args) {
        if (remote === null) return Promise.reject(new Error("远程服务未就绪，请刷新页面"));
        var fn = remote[method];
        if (typeof fn !== "function") return Promise.reject(new Error("远程方法不存在: " + method));
        var p = args === undefined ? fn() : fn(args);
        return p.then(function (r) {
          if (r === null || typeof r !== "object" || r.ok !== true) {
            var msg = (r && typeof r.error === "string") ? r.error : (r && typeof r.message === "string") ? r.message : "调用失败";
            throw new Error(msg);
          }
          var value = r.value;
          if (value && value.ok === true) return value;
          throw new Error((value && typeof value.error === "string") ? value.error : "调用失败");
        });
      };

      // NOTE: children arrive as the SECOND positional argument here, and the
      // call sites below pass the Select element that way. This is the fix for
      // the select elements never rendering (they were dropped before).
      function Field(props, children) {
        return React.createElement("div", { style: T.field },
          React.createElement("span", { style: T.label }, props.label),
          children);
      }

      function Select(props) {
        var opts = [React.createElement("option", { key: "", value: "" }, props.placeholder || "(不设置/继承)")];
        var list = Array.isArray(props.options) ? props.options : [];
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          var v = typeof o === "string" ? o : o.id;
          var label = typeof o === "string" ? o : (o.label !== undefined ? o.label : o.id);
          opts.push(React.createElement("option", { key: String(v), value: String(v) }, String(label)));
        }
        return React.createElement("select", {
          style: T.select,
          value: props.value || "",
          onChange: function (e) { props.onChange(e.target.value); },
        }, opts);
      }

      function modelsOf(providers, pid) {
        var hit = null;
        for (var i = 0; i < providers.length; i++) { if (providers[i].id === pid) { hit = providers[i]; break; } }
        return (hit && Array.isArray(hit.models)) ? hit.models : [];
      }

      function EvalDefaultsPage() {
        var s = React.useState([]); var providers = s[0]; var setProviders = s[1];
        var p1 = React.useState(""); var provider = p1[0]; var setProvider = p1[1];
        var p2 = React.useState(""); var model = p2[0]; var setModel = p2[1];
        var p3 = React.useState(""); var effort = p3[0]; var setEffort = p3[1];
        var p4 = React.useState({ provider: "", model: "", reasoningEffort: "" }); var main = p4[0]; var setMain = p4[1];
        var p5 = React.useState(""); var status = p5[0]; var setStatus = p5[1];
        var p6 = React.useState(true); var loading = p6[0]; var setLoading = p6[1];

        var load = function () {
          setLoading(true); setStatus("");
          return Promise.all([call("getState")]).then(function (rs) {
            var r = rs[0];
            if (r && r.ok) {
              setProviders(Array.isArray(r.providers) ? r.providers : []);
              if (r.defaults) {
                setProvider(r.defaults.provider || "");
                setModel(r.defaults.model || "");
                setEffort(r.defaults.reasoningEffort || "");
              }
              if (r.main) {
                setMain({ provider: r.main.provider || "", model: r.main.model || "", reasoningEffort: r.main.reasoningEffort || "" });
              }
              if (Array.isArray(r.providers) && r.providers.length === 0) {
                setStatus("警告: 没有取到任何 provider。" + ((r.diagnostics && r.diagnostics.length) ? ("诊断: " + r.diagnostics.join("; ")) : ""));
              } else if (r.diagnostics && r.diagnostics.length) {
                setStatus("部分 provider 读取异常: " + r.diagnostics.join("; "));
              }
            } else {
              setStatus("读取失败: " + ((r && r.error) || "未知错误"));
            }
          }).catch(function (e) {
            setStatus("加载失败: " + String((e && e.message) || e));
          }).then(function () { setLoading(false); });
        };

        React.useEffect(function () {
          var alive = true;
          load().then(function () { if (!alive) return; }).catch(function () {});
          return function () { alive = false; };
        }, []);

        var saveDefaults = function () {
          setStatus("保存中…");
          call("setDefaults", { provider: provider, model: model, reasoningEffort: effort }).then(function (r) {
            setStatus(r && r.ok ? "已保存（eval 默认，已持久化）" : ("保存失败: " + ((r && r.error) || "未知错误")));
          }).catch(function (e) { setStatus("保存失败: " + String((e && e.message) || e)); });
        };

        var statusStyle = (status && status.indexOf("已保存") >= 0) ? T.statusOk : T.statusErr;

        return React.createElement("div", { style: T.page },
          React.createElement("h3", { style: T.title }, "Eval 评测默认（模型 + 思考强度）"),
          React.createElement("p", { style: T.hint },
            "对 dsh-eval 评测生效：benchmark.yaml 省略 provider/reasoningEffort 时继承这里的设置。留空 = 继承主对话/网关默认。"),
          React.createElement("div", { style: T.card },
            Field({ label: "Provider（留空 = 继承）" }, React.createElement(Select, { value: provider, onChange: setProvider, options: providers, placeholder: "(继承主对话)" })),
            Field({ label: "Model（留空 = 继承）" }, React.createElement(Select, { value: model, onChange: setModel, options: modelsOf(providers, provider), placeholder: "(继承)" })),
            Field({ label: "思考强度 reasoningEffort（留空 = 继承）" }, React.createElement(Select, { value: effort, onChange: setEffort, options: EFFORTS, placeholder: "(继承)" })),
            React.createElement("div", { style: T.row },
              React.createElement("button", { style: T.btnPrimary, onClick: saveDefaults }, "保存 Eval 默认"),
              React.createElement("button", { style: T.btn, onClick: load }, "刷新"))),
          React.createElement("div", { style: T.divider }, null),
          React.createElement("div", { style: T.card },
            React.createElement("p", { style: T.hint }, "当前主对话默认（只读参考）：" + main.provider + " / " + main.model + (main.reasoningEffort ? (" / " + main.reasoningEffort) : ""))),
          status ? React.createElement("p", { style: Object.assign({}, statusStyle, { whiteSpace: "pre-wrap" }) }, status) : null,
          loading ? React.createElement("p", { style: T.hint }, "加载中…") : null);
      }

      var slots = ctx.get("slots");
      if (slots === undefined) return;
      slots.inject("settings.section", function () {
        return slots.register(
          { name: "settings.section", id: "dsh-eval-defaults", order: 12, label: function () { return "Eval 评测默认"; } },
          function () { return React.createElement(EvalDefaultsPage, null); }
        );
      });
    }

    return { name: name, inject: inject, apply: apply };
  }
});
