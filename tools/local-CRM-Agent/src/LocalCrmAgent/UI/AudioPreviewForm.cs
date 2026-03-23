using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Runtime.InteropServices;
using LocalCrmAgent.Services;
using NAudio.CoreAudioApi;
using NAudio.CoreAudioApi.Interfaces;
using NAudio.Wave;

namespace LocalCrmAgent.UI;

/// <summary>
/// Small floating window that shows real-time audio level bars for
/// microphone input and system/call output. Can be toggled on/off
/// from the tray icon context menu.
///
/// Reads levels from the OS audio session peak meters — no WasapiCapture
/// needed during calls. A "Test" toggle starts a lightweight silent capture
/// so the user can verify their mic works before a call.
/// </summary>
public class AudioPreviewForm : Form
{
    [DllImport("user32.dll")]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);
    private const int GWL_EXSTYLE = -20;
    private const int WS_EX_TOOLWINDOW = 0x00000080;

    private readonly MicrophoneManager _micManager;
    private readonly System.Windows.Forms.Timer _timer;
    private readonly MMDeviceEnumerator _enumerator;

    // Manual mic test — user-toggled silent capture
    private WasapiCapture? _testCapture;
    private string? _testCaptureDeviceId;
    private bool _testActive;

    private float _micLevel;
    private float _callLevel;
    private string _micName = "Microphone";
    private bool _micHasExternalCapture; // true when Zoom/recorder is using the mic

    // Smoothing
    private float _displayMicLevel;
    private float _displayCallLevel;
    private const float SmoothFactor = 0.3f;

    // Layout
    private const int BarHeight = 14;
    private new const int Padding = 10;
    private const int LabelHeight = 14;
    private const int FormWidth = 240;
    private const int TestBtnWidth = 36;
    private const int TestBtnHeight = 14;

    // Test button hit area (computed in OnPaint)
    private Rectangle _testBtnRect;

    public AudioPreviewForm(MicrophoneManager micManager)
    {
        _micManager = micManager;
        _enumerator = new MMDeviceEnumerator();

        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.Manual;
        TopMost = true;
        ShowInTaskbar = false;
        BackColor = Color.FromArgb(30, 30, 30);
        Size = new Size(FormWidth, 80);
        DoubleBuffered = true;
        Opacity = 0.92;

        var screen = Screen.PrimaryScreen!.WorkingArea;
        Location = new Point(screen.Right - FormWidth - 16, screen.Bottom - 80 - 16);

        MouseDown += OnFormMouseDown;
        MouseMove += OnFormMouseMove;
        MouseClick += OnFormMouseClick;

        _timer = new System.Windows.Forms.Timer { Interval = 50 };
        _timer.Tick += OnTimerTick;
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        int exStyle = GetWindowLong(Handle, GWL_EXSTYLE);
        SetWindowLong(Handle, GWL_EXSTYLE, exStyle | WS_EX_TOOLWINDOW);
    }

    protected override void OnShown(EventArgs e)
    {
        base.OnShown(e);
        _timer.Start();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (e.CloseReason == CloseReason.UserClosing)
        {
            e.Cancel = true;
            Hide();
            _timer.Stop();
            return;
        }
        base.OnFormClosing(e);
    }

    public new void Show()
    {
        base.Show();
        _timer.Start();
    }

    public new void Hide()
    {
        _timer.Stop();
        StopTestCapture();
        base.Hide();
    }

    // ─── Test mic toggle ─────────────────────────────────────────────────

    private void ToggleMicTest()
    {
        if (_testActive)
        {
            StopTestCapture();
        }
        else
        {
            StartTestCapture();
        }
    }

    private void StartTestCapture()
    {
        StopTestCapture();
        try
        {
            var micDevice = _micManager.GetRecordingDevice();
            _testCapture = micDevice != null
                ? new WasapiCapture(micDevice)
                : new WasapiCapture();
            _testCaptureDeviceId = micDevice?.ID;

            _testCapture.DataAvailable += (_, _) => { };
            _testCapture.StartRecording();
            _testActive = true;
            Debug.WriteLine($"[AudioPreview] Test capture started: {micDevice?.FriendlyName ?? "default"}");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[AudioPreview] Test capture failed: {ex.Message}");
            _testCapture?.Dispose();
            _testCapture = null;
            _testActive = false;
        }
    }

    private void StopTestCapture()
    {
        if (_testCapture != null)
        {
            try { _testCapture.StopRecording(); } catch { }
            try { _testCapture.Dispose(); } catch { }
            _testCapture = null;
            _testCaptureDeviceId = null;
            _testActive = false;
            Debug.WriteLine("[AudioPreview] Test capture stopped");
        }
    }

    // ─── Level reading ───────────────────────────────────────────────────

    /// <summary>
    /// Read the peak level from a capture device by scanning its audio sessions.
    /// hasExternalCapture is true only if a non-self process has an active session.
    /// </summary>
    private static float GetSessionPeakLevel(MMDevice device, out bool hasExternalCapture)
    {
        hasExternalCapture = false;
        try
        {
            var sessions = device.AudioSessionManager.Sessions;
            if (sessions == null) return 0f;

            int myPid = Environment.ProcessId;
            float maxPeak = 0f;

            for (int i = 0; i < sessions.Count; i++)
            {
                try
                {
                    var session = sessions[i];
                    if (session.State != AudioSessionState.AudioSessionStateActive)
                        continue;

                    int pid = (int)session.GetProcessID;
                    if (pid != 0 && pid != myPid)
                        hasExternalCapture = true;

                    float peak = session.AudioMeterInformation.MasterPeakValue;
                    if (peak > maxPeak)
                        maxPeak = peak;
                }
                catch { }
            }

            return maxPeak;
        }
        catch
        {
            return 0f;
        }
    }

    private void OnTimerTick(object? sender, EventArgs e)
    {
        try
        {
            var micDevice = _micManager.GetRecordingDevice();

            if (micDevice != null)
            {
                float sessionPeak = GetSessionPeakLevel(micDevice, out bool hasExternal);
                _micHasExternalCapture = hasExternal;

                if (sessionPeak <= 0f)
                {
                    try { sessionPeak = micDevice.AudioMeterInformation.MasterPeakValue; }
                    catch { }
                }

                _micLevel = sessionPeak;
                _micName = micDevice.FriendlyName;
                if (_micName.Length > 28) _micName = _micName[..25] + "...";

                // Auto-stop test capture when another app starts using the mic
                if (_testActive && hasExternal)
                {
                    Debug.WriteLine("[AudioPreview] External capture detected — auto-stopping test");
                    StopTestCapture();
                }

                // If test is active and mic device changed, restart on new device
                if (_testActive && micDevice.ID != _testCaptureDeviceId)
                {
                    StartTestCapture();
                }
            }
            else
            {
                _micLevel = 0;
                _micName = "No Microphone";
                _micHasExternalCapture = false;
            }
        }
        catch { _micLevel = 0; }

        try
        {
            var renderDevice = _enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
            _callLevel = renderDevice.AudioMeterInformation.MasterPeakValue;
        }
        catch { _callLevel = 0; }

        float scaledMic = (float)Math.Pow(Math.Clamp(_micLevel, 0f, 1f), 0.35);
        float scaledCall = (float)Math.Pow(Math.Clamp(_callLevel, 0f, 1f), 0.35);

        _displayMicLevel += (scaledMic - _displayMicLevel) * SmoothFactor;
        _displayCallLevel += (scaledCall - _displayCallLevel) * SmoothFactor;

        Invalidate();
    }

    // ─── Painting ────────────────────────────────────────────────────────

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        g.SmoothingMode = SmoothingMode.AntiAlias;
        g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;

        using var labelFont = new Font("Segoe UI", 8f);
        using var smallFont = new Font("Segoe UI", 7f);
        using var labelBrush = new SolidBrush(Color.FromArgb(180, 255, 255, 255));
        using var barBg = new SolidBrush(Color.FromArgb(50, 255, 255, 255));

        int y = Padding;
        int barWidth = FormWidth - Padding * 2;

        // ── Mic row: label + Test button ──
        g.DrawString($"Mic: {_micName}", labelFont, labelBrush, Padding, y);

        // Test button — only show when no external app is capturing
        if (!_micHasExternalCapture || _testActive)
        {
            int btnX = FormWidth - Padding - TestBtnWidth;
            int btnY = y;
            _testBtnRect = new Rectangle(btnX, btnY, TestBtnWidth, TestBtnHeight);

            var btnBg = _testActive
                ? Color.FromArgb(180, 220, 60, 60)
                : Color.FromArgb(120, 80, 180, 80);
            using var btnBrush = new SolidBrush(btnBg);
            using var btnPath = RoundedRect(_testBtnRect, 3);
            g.FillPath(btnBrush, btnPath);

            string btnText = _testActive ? "Stop" : "Test";
            var btnTextSize = g.MeasureString(btnText, smallFont);
            float tx = btnX + (TestBtnWidth - btnTextSize.Width) / 2;
            float ty = btnY + (TestBtnHeight - btnTextSize.Height) / 2;
            using var btnTextBrush = new SolidBrush(Color.White);
            g.DrawString(btnText, smallFont, btnTextBrush, tx, ty);
        }
        else
        {
            _testBtnRect = Rectangle.Empty;
        }

        y += LabelHeight;
        DrawLevelBar(g, Padding, y, barWidth, BarHeight, _displayMicLevel, barBg);
        y += BarHeight + 6;

        // ── Call audio row ──
        g.DrawString("Call Audio (System)", labelFont, labelBrush, Padding, y);
        y += LabelHeight;
        DrawLevelBar(g, Padding, y, barWidth, BarHeight, _displayCallLevel, barBg);

        // Border
        using var borderPen = new Pen(Color.FromArgb(60, 255, 255, 255), 1f);
        g.DrawRectangle(borderPen, 0, 0, Width - 1, Height - 1);
    }

    private static GraphicsPath RoundedRect(Rectangle rect, int radius)
    {
        var path = new GraphicsPath();
        int d = radius * 2;
        path.AddArc(rect.X, rect.Y, d, d, 180, 90);
        path.AddArc(rect.Right - d, rect.Y, d, d, 270, 90);
        path.AddArc(rect.Right - d, rect.Bottom - d, d, d, 0, 90);
        path.AddArc(rect.X, rect.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private static void DrawLevelBar(Graphics g, int x, int y, int width, int height, float level, Brush bg)
    {
        g.FillRectangle(bg, x, y, width, height);

        int fillWidth = (int)(width * Math.Clamp(level, 0f, 1f));
        if (fillWidth > 0)
        {
            Color barColor;
            if (level < 0.5f)
                barColor = Color.FromArgb(80, 220, 80);
            else if (level < 0.8f)
                barColor = Color.FromArgb(220, 200, 40);
            else
                barColor = Color.FromArgb(220, 60, 60);

            using var fillBrush = new SolidBrush(barColor);
            g.FillRectangle(fillBrush, x, y, fillWidth, height);
        }

        using var segPen = new Pen(Color.FromArgb(40, 0, 0, 0), 1f);
        for (int sx = x + 4; sx < x + width; sx += 5)
            g.DrawLine(segPen, sx, y, sx, y + height);
    }

    // ─── Interaction ─────────────────────────────────────────────────────

    private Point _dragStart;
    private bool _dragging;

    private void OnFormMouseClick(object? sender, MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left && !_testBtnRect.IsEmpty && _testBtnRect.Contains(e.Location))
        {
            ToggleMicTest();
        }
    }

    private void OnFormMouseDown(object? sender, MouseEventArgs e)
    {
        if (e.Button == MouseButtons.Left)
        {
            // Don't start drag if clicking the test button
            if (!_testBtnRect.IsEmpty && _testBtnRect.Contains(e.Location))
                return;

            _dragging = true;
            _dragStart = e.Location;
        }
    }

    private void OnFormMouseMove(object? sender, MouseEventArgs e)
    {
        // Update cursor for test button
        if (!_testBtnRect.IsEmpty && _testBtnRect.Contains(e.Location))
            Cursor = Cursors.Hand;
        else
            Cursor = Cursors.Default;

        if (_dragging)
        {
            Location = new Point(
                Location.X + e.X - _dragStart.X,
                Location.Y + e.Y - _dragStart.Y);
        }
    }

    protected override void OnMouseUp(MouseEventArgs e)
    {
        _dragging = false;
        base.OnMouseUp(e);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _timer.Stop();
            _timer.Dispose();
            StopTestCapture();
            _enumerator.Dispose();
        }
        base.Dispose(disposing);
    }
}
