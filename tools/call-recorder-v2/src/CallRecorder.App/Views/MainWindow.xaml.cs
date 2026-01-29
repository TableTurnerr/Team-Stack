using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using Microsoft.Extensions.DependencyInjection;
using CallRecorder.Core.Models;
using CallRecorder.Core.Services;

namespace CallRecorder.App.Views;

public partial class MainWindow : Window
{
    private readonly WindowService _windowService;
    private readonly CallStateService _callStateService;
    private readonly ScreenCaptureService _captureService;
    private readonly OcrService _ocrService;
    
    private WindowInfo? _selectedWindow;
    private SidebarWindow? _sidebarWindow;
    private bool _isMonitoring;
    
    public MainWindow()
    {
        InitializeComponent();
        
        // Get services from DI
        _windowService = App.Services.GetRequiredService<WindowService>();
        _captureService = App.Services.GetRequiredService<ScreenCaptureService>();
        _ocrService = App.Services.GetRequiredService<OcrService>();
        _callStateService = App.Services.GetRequiredService<CallStateService>();
        
        // Subscribe to events
        _callStateService.StateChanged += OnCallStateChanged;
        _callStateService.DebugMessage += OnDebugMessage;
        
        // Load windows on startup
        Loaded += (s, e) => RefreshWindowList();
    }
    
    private void RefreshWindowList()
    {
        var showZoomOnly = ZoomOnlyCheckbox.IsChecked == true;
        var windows = showZoomOnly 
            ? _windowService.GetZoomWindows() 
            : _windowService.GetAllWindows();
        
        WindowListBox.ItemsSource = windows;
        
        LogDebug($"Found {windows.Count} windows" + (showZoomOnly ? " (Zoom only)" : ""));
    }
    
    private void RefreshButton_Click(object sender, RoutedEventArgs e)
    {
        RefreshWindowList();
    }
    
    private void ZoomOnlyCheckbox_Changed(object sender, RoutedEventArgs e)
    {
        RefreshWindowList();
    }
    
    private void WindowListBox_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _selectedWindow = WindowListBox.SelectedItem as WindowInfo;
        StartButton.IsEnabled = _selectedWindow != null;
        
        if (_selectedWindow != null)
        {
            LogDebug($"Selected: {_selectedWindow.Title}");
        }
    }
    
    private void StartButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isMonitoring)
        {
            StopMonitoring();
        }
        else
        {
            StartMonitoring();
        }
    }
    
    private void StartMonitoring()
    {
        if (_selectedWindow == null)
            return;
        
        // Set target window
        _callStateService.SetTargetWindow(_selectedWindow.Handle);
        
        // Start monitoring
        _callStateService.StartMonitoring();
        _isMonitoring = true;
        
        // Update UI
        StartButton.Content = "Stop Monitoring";
        StartButton.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#EF4444"));
        UpdateStatus("Monitoring", "#22C55E");
        
        // Open sidebar (hidden until call detected)
        _sidebarWindow = new SidebarWindow(_callStateService, App.Services.GetRequiredService<AudioRecorderService>());
        _sidebarWindow.Show();
        _sidebarWindow.Hide(); // Start hidden
        
        LogDebug($"Started monitoring: {_selectedWindow.Title}");
    }
    
    private void StopMonitoring()
    {
        _callStateService.StopMonitoring();
        _isMonitoring = false;
        
        // Update UI
        StartButton.Content = "Start Monitoring";
        StartButton.Background = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#3B82F6"));
        UpdateStatus("Stopped", "#888888");
        
        // Close sidebar
        _sidebarWindow?.Close();
        _sidebarWindow = null;
        
        LogDebug("Stopped monitoring");
    }
    
    private void OnCallStateChanged(object? sender, CallStateInfo state)
    {
        Dispatcher.Invoke(() =>
        {
            switch (state.State)
            {
                case CallState.Idle:
                    UpdateStatus("Idle - Waiting for call", "#888888");
                    _sidebarWindow?.Hide();
                    break;
                    
                case CallState.NumberEntered:
                    UpdateStatus($"Number: {state.PhoneNumber}", "#F59E0B");
                    break;
                    
                case CallState.Calling:
                    UpdateStatus($"Calling {state.PhoneNumber}...", "#F59E0B");
                    _sidebarWindow?.ShowCallPrompt(state);
                    break;
                    
                case CallState.Active:
                    UpdateStatus($"Active call: {state.PhoneNumber} ({state.Duration:mm\\:ss})", "#22C55E");
                    break;
                    
                case CallState.Ended:
                    UpdateStatus("Call ended - Processing...", "#3B82F6");
                    break;
            }
            
            if (state.IsMinimized)
            {
                UpdateStatus("⚠️ WINDOW MINIMIZED - Recording blind!", "#EF4444");
            }
        });
    }
    
    private void UpdateStatus(string text, string color)
    {
        StatusBorder.Visibility = Visibility.Visible;
        StatusText.Text = text;
        StatusDot.Fill = new SolidColorBrush((Color)ColorConverter.ConvertFromString(color));
    }
    
    private void OnDebugMessage(object? sender, string message)
    {
        LogDebug(message);
    }
    
    private void LogDebug(string message)
    {
        Dispatcher.Invoke(() =>
        {
            var timestamp = DateTime.Now.ToString("HH:mm:ss");
            DebugTextBox.AppendText($"[{timestamp}] {message}\n");
            DebugTextBox.ScrollToEnd();
        });
    }
    
    protected override void OnClosed(EventArgs e)
    {
        StopMonitoring();
        _callStateService.Dispose();
        _captureService.Dispose();
        _ocrService.Dispose();
        base.OnClosed(e);
    }
}
