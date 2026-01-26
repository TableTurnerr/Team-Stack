using System.Drawing;
using System.Text.RegularExpressions;
using Tesseract;

namespace CallRecorder.Core.Services;

/// <summary>
/// Service for extracting text from images using Tesseract OCR
/// </summary>
public class OcrService : IDisposable
{
    private TesseractEngine? _engine;
    private readonly string _tessDataPath;
    private bool _isInitialized;
    
    // Regex patterns for detection
    private static readonly Regex PhoneNumberRegex = new(
        @"\+?1?\s*\(?[0-9]{3}\)?[-.\s]?[0-9]{3}[-.\s]?[0-9]{4}|" +  // US format
        @"\+?[0-9]{10,15}",  // International format
        RegexOptions.Compiled);
    
    private static readonly Regex TimerRegex = new(
        @"\b([0-9]{1,2}):([0-9]{2})\b",  // MM:SS or H:MM:SS
        RegexOptions.Compiled);
    
    private static readonly Regex CallingRegex = new(
        @"calling\.{0,3}",  // "Calling" with optional dots
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
    
    public OcrService(string? tessDataPath = null)
    {
        _tessDataPath = tessDataPath ?? Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "tessdata");
    }
    
    /// <summary>
    /// Initializes the OCR engine
    /// </summary>
    public bool Initialize()
    {
        try
        {
            if (!Directory.Exists(_tessDataPath))
            {
                Directory.CreateDirectory(_tessDataPath);
            }
            
            // Check if trained data exists
            var engDataPath = Path.Combine(_tessDataPath, "eng.traineddata");
            if (!File.Exists(engDataPath))
            {
                throw new FileNotFoundException(
                    $"Tesseract trained data not found. Please download 'eng.traineddata' to: {_tessDataPath}");
            }
            
            _engine = new TesseractEngine(_tessDataPath, "eng", EngineMode.Default);
            _engine.SetVariable("tessedit_char_whitelist", "0123456789+-().: ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz");
            _isInitialized = true;
            return true;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"OCR initialization failed: {ex.Message}");
            return false;
        }
    }
    
    /// <summary>
    /// Extracts all text from an image
    /// </summary>
    public string ExtractText(Bitmap image)
    {
        if (!_isInitialized || _engine == null)
            return string.Empty;
        
        try
        {
            using var pix = ConvertBitmapToPix(image);
            using var page = _engine.Process(pix);
            return page.GetText().Trim();
        }
        catch (Exception ex)
        {
            Console.WriteLine($"OCR error: {ex.Message}");
            return string.Empty;
        }
    }
    
    /// <summary>
    /// Extracts phone number from image
    /// </summary>
    public string? ExtractPhoneNumber(Bitmap image)
    {
        var text = ExtractText(image);
        return ExtractPhoneNumberFromText(text);
    }
    
    /// <summary>
    /// Extracts phone number from text
    /// </summary>
    public string? ExtractPhoneNumberFromText(string text)
    {
        var match = PhoneNumberRegex.Match(text);
        if (match.Success)
        {
            // Clean up the phone number - keep only digits and leading +
            var phone = match.Value;
            var cleaned = new string(phone.Where(c => char.IsDigit(c) || c == '+').ToArray());
            return cleaned.Length >= 10 ? cleaned : null;
        }
        return null;
    }
    
    /// <summary>
    /// Extracts call duration from image
    /// </summary>
    public TimeSpan? ExtractTimer(Bitmap image)
    {
        var text = ExtractText(image);
        return ExtractTimerFromText(text);
    }
    
    /// <summary>
    /// Extracts call duration from text
    /// </summary>
    public TimeSpan? ExtractTimerFromText(string text)
    {
        var match = TimerRegex.Match(text);
        if (match.Success)
        {
            var minutes = int.Parse(match.Groups[1].Value);
            var seconds = int.Parse(match.Groups[2].Value);
            return new TimeSpan(0, minutes, seconds);
        }
        return null;
    }
    
    /// <summary>
    /// Checks if "Calling" text is present
    /// </summary>
    public bool IsCallingTextPresent(Bitmap image)
    {
        var text = ExtractText(image);
        return IsCallingTextPresentInText(text);
    }
    
    /// <summary>
    /// Checks if "Calling" text is present in text
    /// </summary>
    public bool IsCallingTextPresentInText(string text)
    {
        return CallingRegex.IsMatch(text);
    }
    
    /// <summary>
    /// Checks if idle placeholder is present
    /// </summary>
    public bool IsIdlePlaceholderPresent(string text)
    {
        return text.Contains("Enter a name or number", StringComparison.OrdinalIgnoreCase);
    }
    
    /// <summary>
    /// Performs full analysis on an image
    /// </summary>
    public OcrResult AnalyzeImage(Bitmap image)
    {
        var text = ExtractText(image);
        
        return new OcrResult
        {
            RawText = text,
            PhoneNumber = ExtractPhoneNumberFromText(text),
            Timer = ExtractTimerFromText(text),
            IsCallingTextPresent = IsCallingTextPresentInText(text),
            IsIdlePlaceholder = IsIdlePlaceholderPresent(text)
        };
    }
    
    private Pix ConvertBitmapToPix(Bitmap bitmap)
    {
        // Convert Bitmap to byte array
        using var ms = new MemoryStream();
        bitmap.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
        var bytes = ms.ToArray();
        return Pix.LoadFromMemory(bytes);
    }
    
    public void Dispose()
    {
        _engine?.Dispose();
        _engine = null;
        _isInitialized = false;
    }
}

/// <summary>
/// Result of OCR analysis
/// </summary>
public class OcrResult
{
    public string RawText { get; set; } = string.Empty;
    public string? PhoneNumber { get; set; }
    public TimeSpan? Timer { get; set; }
    public bool IsCallingTextPresent { get; set; }
    public bool IsIdlePlaceholder { get; set; }
}
