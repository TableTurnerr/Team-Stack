using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using CallRecorder.Core.Models;

namespace CallRecorder.Core.Services;

/// <summary>
/// Service for capturing screenshots of windows
/// </summary>
public class ScreenCaptureService : IDisposable
{
    #region Win32 API
    
    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
    
    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, int nFlags);
    
    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hWnd);
    
    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    
    [DllImport("gdi32.dll")]
    private static extern bool BitBlt(IntPtr hdc, int x, int y, int cx, int cy,
        IntPtr hdcSrc, int x1, int y1, int rop);
    
    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left, Top, Right, Bottom;
        public int Width => Right - Left;
        public int Height => Bottom - Top;
    }
    
    private const int PW_RENDERFULLCONTENT = 2;
    private const int SRCCOPY = 0x00CC0020;
    
    #endregion
    
    private IntPtr _targetWindow;
    private bool _isCapturing;
    private CancellationTokenSource? _captureTokenSource;
    
    public event EventHandler<Bitmap>? FrameCaptured;
    public event EventHandler<Exception>? CaptureError;
    
    /// <summary>
    /// Sets the target window to capture
    /// </summary>
    public void SetTargetWindow(IntPtr windowHandle)
    {
        _targetWindow = windowHandle;
    }
    
    /// <summary>
    /// Captures a single frame from the target window
    /// </summary>
    public Bitmap? CaptureFrame()
    {
        if (_targetWindow == IntPtr.Zero)
            return null;
        
        try
        {
            if (!GetWindowRect(_targetWindow, out RECT rect))
                return null;
            
            int width = rect.Width;
            int height = rect.Height;
            
            if (width <= 0 || height <= 0)
                return null;
            
            var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb);
            
            using (var graphics = Graphics.FromImage(bitmap))
            {
                var hdc = graphics.GetHdc();
                
                // Try PrintWindow first (works with background windows)
                if (!PrintWindow(_targetWindow, hdc, PW_RENDERFULLCONTENT))
                {
                    // Fallback to BitBlt (requires window to be visible)
                    var srcDc = GetDC(_targetWindow);
                    BitBlt(hdc, 0, 0, width, height, srcDc, 0, 0, SRCCOPY);
                    ReleaseDC(_targetWindow, srcDc);
                }
                
                graphics.ReleaseHdc(hdc);
            }
            
            return bitmap;
        }
        catch (Exception ex)
        {
            CaptureError?.Invoke(this, ex);
            return null;
        }
    }
    
    /// <summary>
    /// Captures only the top portion of the window (for OCR efficiency)
    /// </summary>
    public Bitmap? CaptureTopPortion(int heightPixels = 200)
    {
        var fullFrame = CaptureFrame();
        if (fullFrame == null)
            return null;
        
        try
        {
            int captureHeight = Math.Min(heightPixels, fullFrame.Height);
            var topPortion = new Bitmap(fullFrame.Width, captureHeight, PixelFormat.Format32bppArgb);
            
            using (var graphics = Graphics.FromImage(topPortion))
            {
                graphics.DrawImage(fullFrame, 
                    new Rectangle(0, 0, fullFrame.Width, captureHeight),
                    new Rectangle(0, 0, fullFrame.Width, captureHeight),
                    GraphicsUnit.Pixel);
            }
            
            fullFrame.Dispose();
            return topPortion;
        }
        catch
        {
            fullFrame.Dispose();
            return null;
        }
    }
    
    /// <summary>
    /// Starts continuous capture at specified interval
    /// </summary>
    public void StartContinuousCapture(int intervalMs = 500)
    {
        if (_isCapturing)
            return;
        
        _isCapturing = true;
        _captureTokenSource = new CancellationTokenSource();
        
        Task.Run(async () =>
        {
            while (!_captureTokenSource.Token.IsCancellationRequested)
            {
                try
                {
                    var frame = CaptureFrame();
                    if (frame != null)
                    {
                        FrameCaptured?.Invoke(this, frame);
                    }
                    
                    await Task.Delay(intervalMs, _captureTokenSource.Token);
                }
                catch (TaskCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    CaptureError?.Invoke(this, ex);
                }
            }
        }, _captureTokenSource.Token);
    }
    
    /// <summary>
    /// Stops continuous capture
    /// </summary>
    public void StopContinuousCapture()
    {
        _isCapturing = false;
        _captureTokenSource?.Cancel();
        _captureTokenSource?.Dispose();
        _captureTokenSource = null;
    }
    
    public void Dispose()
    {
        StopContinuousCapture();
    }
}
