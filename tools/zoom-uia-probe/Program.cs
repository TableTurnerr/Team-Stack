using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Windows.Automation;

namespace ZoomUiaProbe;

// Standalone UIA probe — Zoom desktop app.
//
// Only dumps the Zoom *Phone* subtree (class "PhoneChildWindow"). The main
// Workplace window tree is too large (chat, meetings, etc.) and we only
// care about the phone UI for call-ownership detection.
//
// Usage:   dotnet run --project tools/zoom-uia-probe
// Output:  %USERPROFILE%\Desktop\zoom-uia-dump-<timestamp>.txt
//
// Run while the Zoom Phone panel is visible, ideally with a live call
// (and a second call ringing if possible — the concurrent scenario).

internal static class Program
{
    private const int MaxDepth = 20;
    private const int MaxChildrenPerNode = 120;

    // Classes we want to dump in full. PhoneChildWindow = main phone panel
    // embedded in Zoom Workplace. SipCallNormalIncomingCallWindow = the
    // separate top-level toast shown while an inbound call is ringing.
    private static readonly string[] TargetWindowClasses =
    {
        "PhoneChildWindow",
        "SipCallNormalIncomingCallWindow",
    };

    private static readonly string[] TargetProcessNames =
    {
        "Zoom", "CptHost", "ZoomPhone", "Zoom_launcher",
    };

    private static int _nodeCount;

    [STAThread]
    public static int Main(string[] args)
    {
        if (args.Length > 0 && (args[0] == "--live" || args[0] == "-l"))
            return RunLive();
        if (args.Length > 0 && (args[0] == "--tree" || args[0] == "-t"))
            return RunTreeDump();
        if (args.Length > 0 && (args[0] == "--state" || args[0] == "-s"))
            return RunOneShotState();

        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var outPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            $"zoom-uia-dump-{stamp}.txt");

        using var writer = new StreamWriter(outPath, false, new UTF8Encoding(false))
        {
            AutoFlush = true,
        };
        writer.WriteLine($"Zoom UIA Probe — {DateTime.Now:O}");
        writer.WriteLine($"Filter: subtrees whose class is in [{string.Join(", ", TargetWindowClasses)}]");
        writer.WriteLine(new string('=', 80));

        var zoomPids = FindZoomProcessIds();
        writer.WriteLine($"Matching Zoom PIDs: {string.Join(", ", zoomPids)}");
        Console.WriteLine($"Zoom PIDs: {string.Join(", ", zoomPids)}");
        if (zoomPids.Count == 0)
        {
            writer.WriteLine("NO ZOOM PROCESSES FOUND. Is the Zoom desktop app open?");
            Console.WriteLine("No Zoom processes found.");
            return 1;
        }

        var root = AutomationElement.RootElement;
        AutomationElementCollection topWindows;
        try
        {
            topWindows = root.FindAll(TreeScope.Children,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window));
        }
        catch (Exception ex)
        {
            writer.WriteLine($"Failed to enumerate top-level windows: {ex.Message}");
            return 2;
        }

        var targetRoots = new List<AutomationElement>();
        foreach (AutomationElement win in topWindows)
        {
            int pid;
            try { pid = win.Current.ProcessId; } catch { continue; }
            if (!zoomPids.Contains(pid)) continue;

            string winCls = Safe(() => win.Current.ClassName);
            string winName = Safe(() => win.Current.Name);
            writer.WriteLine();
            writer.WriteLine($"-- Top window  PID={pid}  class={winCls}  name=\"{Trim(winName)}\"");

            // If the top-level window itself is a target class, dump it directly.
            // Otherwise walk inward looking for target-class descendants
            // (PhoneChildWindow is nested inside ZPPTMainFrmWndClassEx).
            if (IsTargetClass(winCls))
                targetRoots.Add(win);
            else
                FindTargetRoots(win, targetRoots, 0);
        }

        writer.WriteLine();
        writer.WriteLine(new string('=', 80));
        writer.WriteLine($"Target subtree roots found: {targetRoots.Count}");

        Console.WriteLine($"Found {targetRoots.Count} target subtree(s). Dumping…");

        foreach (var root2 in targetRoots)
        {
            string cls = Safe(() => root2.Current.ClassName);
            writer.WriteLine();
            writer.WriteLine(new string('#', 80));
            writer.WriteLine($"# SUBTREE  class={cls}  PID={Safe(() => root2.Current.ProcessId.ToString())}");
            writer.WriteLine(new string('#', 80));
            DumpElement(root2, 0, writer);
        }

        writer.WriteLine();
        writer.WriteLine(new string('=', 80));
        writer.WriteLine($"Total elements dumped: {_nodeCount}");

        Console.WriteLine($"Dump complete — {_nodeCount} elements.");
        Console.WriteLine($"File: {outPath}");
        return 0;
    }

    // ------------------------------------------------------------------
    // ONE-SHOT STATE MODE (used by the agent as a subprocess)
    // ------------------------------------------------------------------
    //
    // Scans Zoom's UIA tree once and prints a single compact JSON line
    // describing the call state. The agent spawns this periodically and
    // parses stdout — in-process UIA from the agent process itself hangs
    // on cross-process marshaling, so we isolate UIA to this clean child.

    private static int RunOneShotState()
    {
        var pids = FindZoomProcessIds();
        var snap = LiveScan(pids);
        // Emit compact, parseable JSON. No frills — keep it robust.
        var sb = new StringBuilder();
        sb.Append('{');
        sb.Append("\"zoomDetected\":").Append(pids.Count > 0 ? "true" : "false");
        sb.Append(",\"hasActiveCall\":").Append(snap.HasActiveCall ? "true" : "false");
        sb.Append(",\"hasIncomingRing\":").Append(snap.HasIncomingRing ? "true" : "false");
        sb.Append(",\"accountPresenceOnCall\":").Append(snap.AccountPresenceOnCall ? "true" : "false");
        sb.Append(",\"activePhoneRaw\":").Append(JsonStr(snap.ActivePhone));
        sb.Append(",\"activeStatusText\":").Append(JsonStr(snap.ActiveStatus));
        sb.Append(",\"incomingCallerName\":").Append(JsonStr(snap.IncomingCallerName));
        sb.Append(",\"incomingCallerNumber\":").Append(JsonStr(snap.IncomingCallerNumber));
        sb.Append('}');
        Console.Out.WriteLine(sb.ToString());
        return 0;
    }

    private static string JsonStr(string? s)
    {
        if (s == null) return "null";
        var sb = new StringBuilder("\"");
        foreach (var c in s)
        {
            switch (c)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (c < ' ') sb.Append($"\\u{(int)c:x4}");
                    else sb.Append(c);
                    break;
            }
        }
        sb.Append('"');
        return sb.ToString();
    }

    // ------------------------------------------------------------------
    // TREE DUMP MODE
    // ------------------------------------------------------------------
    //
    // Dumps the full descendant tree of every top-level Zoom window to
    // stdout (and a file on Desktop). Unlike the default mode, this does
    // NOT filter by class, so we can see what Zoom's current UIA tree
    // actually looks like if the expected classes have been renamed.

    private static int RunTreeDump()
    {
        var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var outPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            $"zoom-tree-dump-{stamp}.txt");

        using var writer = new StreamWriter(outPath, false, new UTF8Encoding(false))
        {
            AutoFlush = true,
        };

        var zoomPids = FindZoomProcessIds();
        writer.WriteLine($"Zoom PIDs: {string.Join(", ", zoomPids)}");
        Console.WriteLine($"Zoom PIDs: {string.Join(", ", zoomPids)}");
        if (zoomPids.Count == 0) return 1;

        AutomationElementCollection topWindows;
        try
        {
            topWindows = AutomationElement.RootElement.FindAll(
                TreeScope.Children,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window));
        }
        catch (Exception ex) { Console.WriteLine("top-enum err: " + ex.Message); return 2; }

        // Summary pass — unique class-name frequency
        var classFreq = new Dictionary<string, int>();
        var controlIdsFound = new HashSet<string>();
        int total = 0;

        foreach (AutomationElement win in topWindows)
        {
            int pid;
            try { pid = win.Current.ProcessId; } catch { continue; }
            if (!zoomPids.Contains(pid)) continue;

            string cls = Safe(() => win.Current.ClassName);
            string nm = Safe(() => win.Current.Name);
            writer.WriteLine();
            writer.WriteLine($"======= TOP WINDOW pid={pid} cls={cls} name=\"{Trim(nm)}\" =======");
            DumpTree(win, 0, 15, writer, classFreq, controlIdsFound, ref total);
        }

        writer.WriteLine();
        writer.WriteLine("=== CLASS FREQUENCY ===");
        foreach (var kv in classFreq.OrderByDescending(k => k.Value))
            writer.WriteLine($"  {kv.Value,6}  {kv.Key}");

        writer.WriteLine();
        writer.WriteLine("=== CONTROLIDS SEEN (HelpText JSON) ===");
        foreach (var c in controlIdsFound.OrderBy(s => s))
            writer.WriteLine($"  {c}");

        writer.WriteLine();
        writer.WriteLine($"Total elements: {total}");
        Console.WriteLine($"Total elements: {total}");
        Console.WriteLine($"Unique classes: {classFreq.Count}");
        Console.WriteLine($"Unique controlIDs: {controlIdsFound.Count}");
        Console.WriteLine($"File: {outPath}");

        // Also emit concise class/controlID summary to stdout so piped log
        // captures it without needing to open the dump file.
        Console.WriteLine();
        Console.WriteLine("--- CLASSES (top 40 by frequency) ---");
        foreach (var kv in classFreq.OrderByDescending(k => k.Value).Take(40))
            Console.WriteLine($"  {kv.Value,6}  {kv.Key}");
        Console.WriteLine();
        Console.WriteLine("--- CONTROLIDS (all unique) ---");
        foreach (var c in controlIdsFound.OrderBy(s => s))
            Console.WriteLine($"  {c}");

        return 0;
    }

    private static void DumpTree(
        AutomationElement el, int depth, int maxDepth, StreamWriter w,
        Dictionary<string, int> classFreq, HashSet<string> controlIds,
        ref int total)
    {
        total++;
        if (depth > maxDepth) return;

        string name = Safe(() => el.Current.Name);
        string cls = Safe(() => el.Current.ClassName);
        string autoId = Safe(() => el.Current.AutomationId);
        string help = Safe(() => el.Current.HelpText);

        if (!string.IsNullOrEmpty(cls))
        {
            classFreq.TryGetValue(cls, out int c);
            classFreq[cls] = c + 1;
        }
        int hi = help.IndexOf("\"controlID\":\"", StringComparison.Ordinal);
        if (hi >= 0)
        {
            hi += "\"controlID\":\"".Length;
            int hj = help.IndexOf('"', hi);
            if (hj > hi) controlIds.Add(help.Substring(hi, hj - hi));
        }

        var prefix = Indent(depth);
        string suffix = "";
        if (!string.IsNullOrEmpty(autoId)) suffix += $" autoId={autoId}";
        if (hi >= 0) suffix += $" help={Trim(help)}";
        w.WriteLine($"{prefix}[{cls}] \"{Trim(name)}\"{suffix}");

        AutomationElementCollection? children = null;
        try { children = el.FindAll(TreeScope.Children, Condition.TrueCondition); } catch { }
        if (children == null) return;
        int count = Math.Min(children.Count, 80);
        for (int i = 0; i < count; i++)
            DumpTree(children[i], depth + 1, maxDepth, w, classFreq, controlIds, ref total);
        if (children.Count > count)
            w.WriteLine($"{prefix}  … [{children.Count - count} more truncated]");
    }

    // ------------------------------------------------------------------
    // LIVE WATCH MODE
    // ------------------------------------------------------------------
    //
    // Continuously polls the Zoom UIA tree every 500ms and prints a
    // concise one-line status to stdout whenever something changes. Also
    // prints a full subtree snapshot on state transitions so we can see
    // exactly what UIA looks like at the moment the change happens.
    //
    // This mirrors the agent's ZoomUiWatcher.Scan() logic so its output
    // tells us exactly what the agent sees (or fails to see).

    private static int RunLive()
    {
        // Force line buffering so output is flushed immediately when piped
        // (default is block buffering when stdout is not a console).
        var stdout = new StreamWriter(Console.OpenStandardOutput()) { AutoFlush = true };
        Console.SetOut(stdout);

        Console.WriteLine("=== Zoom UIA Live Watcher ===");
        Console.WriteLine("Polling every 500ms. Press Ctrl+C to stop.");
        Console.WriteLine();

        string? lastSig = null;
        int iter = 0;

        while (true)
        {
            iter++;
            var sw = System.Diagnostics.Stopwatch.StartNew();
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] iter={iter} scanning…");
            var pids = FindZoomProcessIds();
            var snap = LiveScan(pids);
            sw.Stop();
            Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] iter={iter} scan took {sw.ElapsedMilliseconds}ms pidCount={snap.ZoomPidCount} topWins={snap.TopWindowsFound} phoneWin={snap.PhoneChildWindowFound} active={snap.HasActiveCall} ring={snap.HasIncomingRing}");

            // Compact signature — changes in any of these trigger full output
            string sig = $"{snap.ZoomPidCount}|{snap.TopWindowsFound}|" +
                         $"{snap.PhoneChildWindowFound}|{snap.SipIncomingWindowFound}|" +
                         $"{snap.HasActiveCall}|{snap.HasIncomingRing}|" +
                         $"{snap.AccountPresenceOnCall}|{snap.ActivePhone}|" +
                         $"{snap.IncomingCallerNumber}|{snap.ActiveStatus}";

            if (sig != lastSig)
            {
                lastSig = sig;
                Console.WriteLine($"[{DateTime.Now:HH:mm:ss.fff}] #{iter}");
                Console.WriteLine($"  ZoomPids:          {snap.ZoomPidCount}  ({string.Join(",", snap.ZoomPids)})");
                Console.WriteLine($"  TopWindowsFound:   {snap.TopWindowsFound}");
                Console.WriteLine($"  ZoomTopWindows:    {string.Join(" | ", snap.ZoomTopWindows)}");
                Console.WriteLine($"  PhoneChildWindow:  {(snap.PhoneChildWindowFound ? "YES (depth=" + snap.PhoneChildDepth + ")" : "NO")}");
                Console.WriteLine($"  SipIncomingWindow: {(snap.SipIncomingWindowFound ? "YES" : "NO")}");
                Console.WriteLine($"  HasActiveCall:     {snap.HasActiveCall}  (panel_single_channel={snap.PanelSingleChannelFound})");
                Console.WriteLine($"  HasIncomingRing:   {snap.HasIncomingRing}");
                Console.WriteLine($"  AccountPresence:   {snap.AccountPresenceOnCall}  (sip_contact_avatar name=\"{Trim(snap.SipContactAvatarName)}\")");
                Console.WriteLine($"  ActivePhone:       {snap.ActivePhone}");
                Console.WriteLine($"  ActiveStatus:      {snap.ActiveStatus}");
                Console.WriteLine($"  IncomingNumber:    {snap.IncomingCallerNumber}");
                Console.WriteLine($"  IncomingName:      {snap.IncomingCallerName}");
                if (snap.ControlIdsFoundInPhone.Count > 0)
                {
                    Console.WriteLine($"  controlIDs seen under PhoneChildWindow ({snap.ControlIdsFoundInPhone.Count}):");
                    foreach (var c in snap.ControlIdsFoundInPhone.Take(40))
                        Console.WriteLine($"    - {c}");
                    if (snap.ControlIdsFoundInPhone.Count > 40)
                        Console.WriteLine($"    … ({snap.ControlIdsFoundInPhone.Count - 40} more)");
                }
                if (!string.IsNullOrEmpty(snap.ErrorMsg))
                    Console.WriteLine($"  ERROR:             {snap.ErrorMsg}");
                Console.WriteLine();
            }

            System.Threading.Thread.Sleep(500);
        }
    }

    private class LiveSnap
    {
        public int ZoomPidCount;
        public List<int> ZoomPids = new();
        public int TopWindowsFound;
        public List<string> ZoomTopWindows = new();
        public bool PhoneChildWindowFound;
        public int PhoneChildDepth;
        public bool SipIncomingWindowFound;
        public bool PanelSingleChannelFound;
        public bool HasActiveCall;
        public bool HasIncomingRing;
        public bool AccountPresenceOnCall;
        public string SipContactAvatarName = "";
        public string ActivePhone = "";
        public string ActiveStatus = "";
        public string IncomingCallerNumber = "";
        public string IncomingCallerName = "";
        public HashSet<string> ControlIdsFoundInPhone = new();
        public string ErrorMsg = "";
    }

    private static LiveSnap LiveScan(HashSet<int> zoomPids)
    {
        var snap = new LiveSnap();
        snap.ZoomPids = zoomPids.ToList();
        snap.ZoomPidCount = zoomPids.Count;
        if (zoomPids.Count == 0) return snap;

        Console.WriteLine($"  [trace] enumerating top-level windows…");
        AutomationElementCollection topWindows;
        try
        {
            topWindows = AutomationElement.RootElement.FindAll(
                TreeScope.Children,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Window));
        }
        catch (Exception ex) { snap.ErrorMsg = "top-enum: " + ex.Message; return snap; }
        Console.WriteLine($"  [trace] top-level count={topWindows.Count}");

        foreach (AutomationElement win in topWindows)
        {
            int pid;
            try { pid = win.Current.ProcessId; } catch { continue; }
            if (!zoomPids.Contains(pid)) continue;

            snap.TopWindowsFound++;
            string cls = Safe(() => win.Current.ClassName);
            string nm = Safe(() => win.Current.Name);
            snap.ZoomTopWindows.Add($"pid={pid} cls={cls} name=\"{Trim(nm)}\"");
            Console.WriteLine($"  [trace] matched top window pid={pid} cls={cls}");

            // Single-pass walk of the subtree. We collect everything we need
            // from one recursive descent so we never re-enumerate the same
            // children — Zoom's cross-process UIA provider becomes pathologically
            // slow when the same elements are walked repeatedly.
            if (string.Equals(cls, "SipCallNormalIncomingCallWindow", StringComparison.OrdinalIgnoreCase))
            {
                snap.SipIncomingWindowFound = true;
                snap.HasIncomingRing = true;
                WalkOnce(win, snap, inPhone: false, inRing: true, 0, 20);
            }
            else
            {
                WalkOnce(win, snap, inPhone: false, inRing: false, 0, 20);
            }
        }

        return snap;
    }

    // Single-pass recursive walker that collects every signal in one pass.
    // Sets inPhone=true once we cross into the PhoneChildWindow subtree so
    // that controlIDs/text are attributed correctly.
    private static int _walkCounter;
    private static void WalkOnce(
        AutomationElement el, LiveSnap snap, bool inPhone, bool inRing,
        int depth, int maxDepth)
    {
        if (depth > maxDepth) return;
        _walkCounter++;
        if (_walkCounter % 100 == 0)
            Console.WriteLine($"  [trace] walk n={_walkCounter} depth={depth}");

        string cls = "";
        string help = "";
        string nm = "";
        try { cls = el.Current.ClassName ?? ""; } catch { }
        try { help = el.Current.HelpText ?? ""; } catch { }
        try { nm = el.Current.Name ?? ""; } catch { }

        if (!inPhone && string.Equals(cls, "PhoneChildWindow", StringComparison.OrdinalIgnoreCase))
        {
            snap.PhoneChildWindowFound = true;
            snap.PhoneChildDepth = depth;
            inPhone = true;
        }

        // Extract controlID from HelpText JSON (cheap substring parse).
        string? controlId = null;
        int i = help.IndexOf("\"controlID\":\"", StringComparison.Ordinal);
        if (i >= 0)
        {
            i += "\"controlID\":\"".Length;
            int j = help.IndexOf('"', i);
            if (j > i) controlId = help.Substring(i, j - i);
        }

        if (inPhone && controlId != null)
        {
            snap.ControlIdsFoundInPhone.Add(controlId);

            if (controlId == "panel_single_channel")
            {
                snap.PanelSingleChannelFound = true;
                snap.HasActiveCall = true;
            }
            else if (controlId == "single_channel_channel_name")
                snap.ActivePhone = TryValueOrName(el);
            else if (controlId == "lb_single_channel_status")
                snap.ActiveStatus = TryValueOrName(el);
            else if (controlId == "sip_contact_avatar")
            {
                snap.SipContactAvatarName = nm;
                if (nm.Contains("status: On a call", StringComparison.OrdinalIgnoreCase)
                    || nm.Contains("status:On a call", StringComparison.OrdinalIgnoreCase))
                    snap.AccountPresenceOnCall = true;
            }
        }

        if (inRing && controlId != null)
        {
            if (controlId == "lb_name") snap.IncomingCallerName = TryValueOrName(el);
            else if (controlId == "lb_info") snap.IncomingCallerNumber = TryValueOrName(el);
        }

        AutomationElementCollection? children = null;
        try { children = el.FindAll(TreeScope.Children, Condition.TrueCondition); } catch { }
        if (children == null) return;
        int count = Math.Min(children.Count, 80);
        for (int k = 0; k < count; k++)
            WalkOnce(children[k], snap, inPhone, inRing, depth + 1, maxDepth);
    }

    private static string TryValueOrName(AutomationElement el)
    {
        try
        {
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out var obj) && obj is ValuePattern vp)
            {
                var v = vp.Current.Value;
                if (!string.IsNullOrEmpty(v)) return v;
            }
        }
        catch { }
        try { return el.Current.Name ?? ""; } catch { return ""; }
    }

    private static AutomationElement? FindDescendantByClassLive(
        AutomationElement el, string className, int depth, int maxDepth, ref int foundDepth)
    {
        if (depth > maxDepth) return null;
        try
        {
            if (string.Equals(el.Current.ClassName ?? "", className, StringComparison.OrdinalIgnoreCase))
            {
                foundDepth = depth;
                return el;
            }
        }
        catch { }
        AutomationElementCollection? children = null;
        try { children = el.FindAll(TreeScope.Children, Condition.TrueCondition); } catch { }
        if (children == null) return null;
        int count = Math.Min(children.Count, 60);
        for (int i = 0; i < count; i++)
        {
            var hit = FindDescendantByClassLive(children[i], className, depth + 1, maxDepth, ref foundDepth);
            if (hit != null) return hit;
        }
        return null;
    }

    private static AutomationElement? FindDescendantByControlIdLive(
        AutomationElement el, string controlId, int depth, int maxDepth)
    {
        if (depth > maxDepth) return null;
        if (HasControlIdLive(el, controlId)) return el;
        AutomationElementCollection? children = null;
        try { children = el.FindAll(TreeScope.Children, Condition.TrueCondition); } catch { }
        if (children == null) return null;
        int count = Math.Min(children.Count, 80);
        for (int i = 0; i < count; i++)
        {
            var hit = FindDescendantByControlIdLive(children[i], controlId, depth + 1, maxDepth);
            if (hit != null) return hit;
        }
        return null;
    }

    private static bool HasControlIdLive(AutomationElement el, string controlId)
    {
        string help;
        try { help = el.Current.HelpText ?? ""; } catch { return false; }
        if (help.Length == 0) return false;
        return help.Contains("\"controlID\":\"" + controlId + "\"", StringComparison.Ordinal);
    }

    private static void CollectControlIds(AutomationElement el, HashSet<string> acc, int depth, int maxDepth)
    {
        if (depth > maxDepth) return;
        try
        {
            string help = el.Current.HelpText ?? "";
            int i = help.IndexOf("\"controlID\":\"", StringComparison.Ordinal);
            if (i >= 0)
            {
                i += "\"controlID\":\"".Length;
                int j = help.IndexOf('"', i);
                if (j > i) acc.Add(help.Substring(i, j - i));
            }
        }
        catch { }
        AutomationElementCollection? children = null;
        try { children = el.FindAll(TreeScope.Children, Condition.TrueCondition); } catch { }
        if (children == null) return;
        int count = Math.Min(children.Count, 80);
        for (int i = 0; i < count; i++)
            CollectControlIds(children[i], acc, depth + 1, maxDepth);
    }

    private static string? TextOfControlIdLive(AutomationElement root, string controlId)
    {
        var node = FindDescendantByControlIdLive(root, controlId, 0, 25);
        if (node == null) return null;
        try
        {
            if (node.TryGetCurrentPattern(ValuePattern.Pattern, out var obj) && obj is ValuePattern vp)
            {
                var v = vp.Current.Value;
                if (!string.IsNullOrEmpty(v)) return v;
            }
        }
        catch { }
        try
        {
            var name = node.Current.Name;
            return string.IsNullOrEmpty(name) ? null : name;
        }
        catch { return null; }
    }

    private static bool IsTargetClass(string cls)
    {
        foreach (var t in TargetWindowClasses)
            if (string.Equals(cls, t, StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    // Recursively scan a subtree looking for elements whose class is one of
    // the target classes. Limit depth so we never get lost in massive trees.
    private static void FindTargetRoots(AutomationElement el, List<AutomationElement> acc, int depth)
    {
        if (depth > 6) return;
        string cls = Safe(() => el.Current.ClassName);
        if (IsTargetClass(cls))
        {
            acc.Add(el);
            return;  // dive no further; DumpElement will cover its children
        }

        AutomationElementCollection? children = null;
        try { children = el.FindAll(TreeScope.Children, Condition.TrueCondition); } catch { }
        if (children == null) return;
        int count = Math.Min(children.Count, 40);
        for (int i = 0; i < count; i++)
            FindTargetRoots(children[i], acc, depth + 1);
    }

    private static HashSet<int> FindZoomProcessIds()
    {
        var pids = new HashSet<int>();
        foreach (var p in Process.GetProcesses())
        {
            try
            {
                var name = p.ProcessName ?? "";
                foreach (var target in TargetProcessNames)
                {
                    if (string.Equals(name, target, StringComparison.OrdinalIgnoreCase))
                    {
                        pids.Add(p.Id);
                        break;
                    }
                }
            }
            catch { }
        }
        return pids;
    }

    private static void DumpElement(AutomationElement el, int depth, StreamWriter w)
    {
        _nodeCount++;
        if (depth > MaxDepth)
        {
            w.WriteLine($"{Indent(depth)}… [max depth {MaxDepth} reached]");
            return;
        }

        string name = Safe(() => el.Current.Name);
        string cls = Safe(() => el.Current.ClassName);
        string ctrl = Safe(() => el.Current.ControlType?.ProgrammaticName ?? "");
        string autoId = Safe(() => el.Current.AutomationId);
        string locId = Safe(() => el.Current.LocalizedControlType);
        string help = Safe(() => el.Current.HelpText);
        string value = TryGetValue(el);
        var rect = Safe(() => el.Current.BoundingRectangle.ToString()!) ?? "";
        bool offscreen = SafeBool(() => el.Current.IsOffscreen);
        bool enabled = SafeBool(() => el.Current.IsEnabled);

        var prefix = Indent(depth);
        w.WriteLine($"{prefix}[{ctrl}] \"{Trim(name)}\"");
        if (!string.IsNullOrEmpty(locId))  w.WriteLine($"{prefix}  localized: {locId}");
        if (!string.IsNullOrEmpty(cls))    w.WriteLine($"{prefix}  class:     {cls}");
        if (!string.IsNullOrEmpty(autoId)) w.WriteLine($"{prefix}  autoId:    {autoId}");
        if (!string.IsNullOrEmpty(help))   w.WriteLine($"{prefix}  help:      {Trim(help)}");
        if (!string.IsNullOrEmpty(value))  w.WriteLine($"{prefix}  value:     {Trim(value)}");
        w.WriteLine($"{prefix}  rect:      {rect}  enabled={enabled} offscreen={offscreen}");

        AutomationElementCollection? children = null;
        try { children = el.FindAll(TreeScope.Children, Condition.TrueCondition); } catch { }
        if (children == null) return;

        int count = Math.Min(children.Count, MaxChildrenPerNode);
        for (int i = 0; i < count; i++)
            DumpElement(children[i], depth + 1, w);
        if (children.Count > count)
            w.WriteLine($"{prefix}  … [{children.Count - count} more children truncated]");
    }

    private static string Indent(int d) => new string(' ', d * 2);

    private static string Trim(string? s)
    {
        if (string.IsNullOrEmpty(s)) return "";
        s = s.Replace("\r", "\\r").Replace("\n", "\\n");
        return s.Length > 200 ? s[..200] + "…" : s;
    }

    private static string Safe(Func<string?> f)
    {
        try { return f() ?? ""; } catch { return ""; }
    }

    private static bool SafeBool(Func<bool> f)
    {
        try { return f(); } catch { return false; }
    }

    private static string TryGetValue(AutomationElement el)
    {
        try
        {
            if (el.TryGetCurrentPattern(ValuePattern.Pattern, out var obj) && obj is ValuePattern vp)
                return vp.Current.Value ?? "";
        }
        catch { }
        return "";
    }
}
