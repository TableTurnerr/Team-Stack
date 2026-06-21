using System.Diagnostics;
using System.Runtime.InteropServices;

namespace LocalCrmAgent.Services;

/// <summary>
/// Resolves which process tree the recorder should loopback-capture for a
/// given call channel:
///   • desktop  → the Zoom desktop app (its main process; INCLUDE_TREE then
///                pulls in the CptHost child that actually renders call audio).
///   • web      → the Chrome browser (root process; INCLUDE_TREE pulls in the
///                audio-service child that renders the web-phone audio).
///
/// Targeting the TREE ROOT (rather than a leaf) matters because the process
/// that renders the audio is usually a child helper, and process-loopback's
/// INCLUDE_TARGET_PROCESS_TREE mode captures the target plus its descendants.
/// A caller can pass a <paramref name="hintPid"/> (e.g. the PID that currently
/// owns Zoom's active WASAPI render session) for an exact match.
/// </summary>
internal static class AudioCaptureTarget
{
    // Process names (without .exe), lower-cased.
    private static readonly string[] ZoomNames = ["zoom", "zoomphone", "cpthost"];
    private static readonly string[] ChromeNames = ["chrome"];

    public readonly record struct Target(uint Pid, string Label);

    public static Target? Resolve(string channel, int hintPid = 0)
    {
        bool web = channel is "web" or "chrome" or "browser";

        if (hintPid > 0 && IsAlive(hintPid))
            return new Target((uint)hintPid, $"hint:{hintPid}");

        var names = web ? ChromeNames : ZoomNames;

        var root = ProcessTree.FindTreeRoot(names);
        if (root != 0) return new Target(root, web ? "chrome-root" : "zoom-root");

        var any = ProcessTree.FindAny(names);
        if (any != 0) return new Target(any, web ? "chrome-any" : "zoom-any");

        return null;
    }

    private static bool IsAlive(int pid)
    {
        try { using var p = Process.GetProcessById(pid); return !p.HasExited; }
        catch { return false; }
    }
}

/// <summary>
/// Lightweight process-tree queries over a Toolhelp32 snapshot — cheap, no
/// UIA, no WMI. Used to find the root of an app's process tree by name.
/// </summary>
internal static class ProcessTree
{
    /// <summary>
    /// Find a process whose name is in <paramref name="names"/> and whose
    /// PARENT is NOT in <paramref name="names"/> — i.e. the top of that app's
    /// own process tree. Returns 0 if none found.
    /// </summary>
    public static uint FindTreeRoot(string[] names)
    {
        var procs = Snapshot();
        if (procs.Count == 0) return 0;

        var byId = procs.ToDictionary(p => p.Pid);
        var set = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);

        // Prefer a matching process whose parent is absent or not same-family.
        foreach (var p in procs)
        {
            if (!set.Contains(p.Name)) continue;
            bool parentSameFamily = byId.TryGetValue(p.ParentPid, out var parent)
                                    && set.Contains(parent.Name);
            if (!parentSameFamily) return p.Pid;
        }

        // Everything matched is parented within the family (unexpected) — any will do.
        foreach (var p in procs)
            if (set.Contains(p.Name)) return p.Pid;

        return 0;
    }

    /// <summary>Any process whose name is in <paramref name="names"/>, or 0.</summary>
    public static uint FindAny(string[] names)
    {
        var set = new HashSet<string>(names, StringComparer.OrdinalIgnoreCase);
        foreach (var p in Snapshot())
            if (set.Contains(p.Name)) return p.Pid;
        return 0;
    }

    private readonly record struct ProcInfo(uint Pid, uint ParentPid, string Name);

    private static List<ProcInfo> Snapshot()
    {
        var list = new List<ProcInfo>();
        IntPtr snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (snap == IntPtr.Zero || snap == InvalidHandle) return list;
        try
        {
            var entry = new PROCESSENTRY32W { dwSize = (uint)Marshal.SizeOf<PROCESSENTRY32W>() };
            if (!Process32FirstW(snap, ref entry)) return list;
            do
            {
                var name = entry.szExeFile ?? "";
                if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                    name = name[..^4];
                list.Add(new ProcInfo(entry.th32ProcessID, entry.th32ParentProcessID, name));
            } while (Process32NextW(snap, ref entry));
        }
        catch (Exception ex) { Debug.WriteLine($"[ProcessTree] snapshot failed: {ex.Message}"); }
        finally { CloseHandle(snap); }
        return list;
    }

    // ── Toolhelp32 P/Invoke ───────────────────────────────────────────────

    private const uint TH32CS_SNAPPROCESS = 0x00000002;
    private static readonly IntPtr InvalidHandle = new(-1);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct PROCESSENTRY32W
    {
        public uint dwSize;
        public uint cntUsage;
        public uint th32ProcessID;
        public IntPtr th32DefaultHeapID;
        public uint th32ModuleID;
        public uint cntThreads;
        public uint th32ParentProcessID;
        public int pcPriClassBase;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szExeFile;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr CreateToolhelp32Snapshot(uint dwFlags, uint th32ProcessID);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool Process32FirstW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool Process32NextW(IntPtr hSnapshot, ref PROCESSENTRY32W lppe);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);
}
