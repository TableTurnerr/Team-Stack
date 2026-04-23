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

    public static int Main(string[] args)
    {
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
