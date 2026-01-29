using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using CallRecorder.Core.Models;
using CallRecorder.Core.Services;

namespace CallRecorder.App.Views;

public partial class SidebarWindow : Window
{
    private readonly CallStateService _callStateService;
    private readonly AudioRecorderService _audioRecorder;
    
    private DispatcherTimer? _timerUpdateTimer;
    private DispatcherTimer? _countdownTimer;
    private DispatcherTimer? _blinkTimer;
    
    private DateTime _recordingStartTime;
    private int _countdownSeconds = 10;
    private bool _isBlinkOn = true;
    private bool _isRecording = false;
    private CallRecord _currentRecord = new();
    
    public SidebarWindow(CallStateService callStateService, AudioRecorderService audioRecorder)
    {
        InitializeComponent();
        
        _callStateService = callStateService;
        _audioRecorder = audioRecorder;
        
        // Subscribe to events
        _callStateService.StateChanged += OnCallStateChanged;
        _audioRecorder.MicLevelChanged += OnMicLevelChanged;
        _audioRecorder.DesktopLevelChanged += OnDesktopLevelChanged;
        
        // Interest slider value binding
        InterestSlider.ValueChanged += (s, e) => 
            InterestValueLabel.Text = ((int)InterestSlider.Value).ToString();
        
        // Position window on right edge of screen
        PositionOnScreen();
        
        // Initialize timers
        SetupTimers();
    }
    
    private void PositionOnScreen()
    {
        var screenWidth = SystemParameters.PrimaryScreenWidth;
        Left = screenWidth - Width - 20;
        Top = 50;
    }
    
    private void SetupTimers()
    {
        // Timer update (every second)
        _timerUpdateTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _timerUpdateTimer.Tick += (s, e) => UpdateTimerDisplay();
        
        // Recording dot blink
        _blinkTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(500) };
        _blinkTimer.Tick += (s, e) =>
        {
            _isBlinkOn = !_isBlinkOn;
            RecordingDot.Fill = _isBlinkOn 
                ? new SolidColorBrush((Color)ColorConverter.ConvertFromString("#EF4444"))
                : new SolidColorBrush(Colors.Transparent);
        };
        
        // Countdown timer
        _countdownTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(1) };
        _countdownTimer.Tick += OnCountdownTick;
    }
    
    public void ShowCallPrompt(CallStateInfo state)
    {
        Dispatcher.Invoke(() =>
        {
            // TODO: Show confirmation dialog if AutoRecordOnCall is false
            // For now, auto-start recording
            StartRecording(state);
            Show();
            Activate();
        });
    }
    
    private void StartRecording(CallStateInfo state)
    {
        if (_isRecording) return;
        
        _currentRecord = new CallRecord
        {
            PhoneNumber = state.PhoneNumber,
            CallTime = DateTime.Now
        };
        
        // Update UI
        PhoneNumberLabel.Text = FormatPhoneNumber(state.PhoneNumber ?? "Unknown");
        CompanyLabel.Text = "Company: Matching...";
        
        // Generate file path
        var fileName = $"recording_{DateTime.Now:dd-MM-yyyy_HH-mm-ss}_{state.PhoneNumber ?? "unknown"}.mp3";
        var storageDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
            "CallRecorder", "Recordings");
        var filePath = Path.Combine(storageDir, fileName);
        
        // Start audio recording
        if (_audioRecorder.StartRecording(filePath))
        {
            _currentRecord.LocalFilePath = filePath;
            _isRecording = true;
            _recordingStartTime = DateTime.Now;
            
            // Start timers
            _timerUpdateTimer?.Start();
            _blinkTimer?.Start();
            
            RecordingLabel.Text = "REC";
            RecordingLabel.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#EF4444"));
        }
        else
        {
            RecordingLabel.Text = "ERROR";
            RecordingLabel.Foreground = new SolidColorBrush(Colors.Orange);
        }
    }
    
    private void StopRecording()
    {
        if (!_isRecording) return;
        
        _isRecording = false;
        _timerUpdateTimer?.Stop();
        _blinkTimer?.Stop();
        
        // Stop audio recording
        _audioRecorder.StopRecording();
        
        // Update record
        _currentRecord.Duration = DateTime.Now - _recordingStartTime;
        
        RecordingLabel.Text = "ENDED";
        RecordingLabel.Foreground = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#888888"));
        RecordingDot.Fill = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#888888"));
    }
    
    private void StartCountdown()
    {
        _countdownSeconds = 10;
        CountdownBanner.Visibility = Visibility.Visible;
        CountdownLabel.Text = $"Call ended - Saving in {_countdownSeconds}s...";
        _countdownTimer?.Start();
    }
    
    private void OnCountdownTick(object? sender, EventArgs e)
    {
        _countdownSeconds--;
        
        if (_countdownSeconds <= 0)
        {
            _countdownTimer?.Stop();
            SaveAndClose();
        }
        else
        {
            CountdownLabel.Text = $"Call ended - Saving in {_countdownSeconds}s...";
        }
    }
    
    private void UpdateTimerDisplay()
    {
        var elapsed = DateTime.Now - _recordingStartTime;
        TimerLabel.Text = elapsed.ToString(@"mm\:ss");
    }
    
    private void OnCallStateChanged(object? sender, CallStateInfo state)
    {
        Dispatcher.Invoke(() =>
        {
            // Update phone number if changed
            if (!string.IsNullOrEmpty(state.PhoneNumber) && state.PhoneNumber != _currentRecord.PhoneNumber)
            {
                PhoneNumberLabel.Text = FormatPhoneNumber(state.PhoneNumber);
                _currentRecord.PhoneNumber = state.PhoneNumber;
            }
            
            // Handle minimized warning
            WarningBanner.Visibility = state.IsMinimized ? Visibility.Visible : Visibility.Collapsed;
            
            // Handle call ended
            if (state.State == CallState.Ended && _isRecording)
            {
                StopRecording();
                StartCountdown();
            }
        });
    }
    
    private void OnMicLevelChanged(object? sender, float level)
    {
        Dispatcher.Invoke(() =>
        {
            var maxWidth = 220; // Approximate max width
            MicLevelBar.Width = level * maxWidth;
            MicLevelBar.Background = GetLevelBrush(level);
        });
    }
    
    private void OnDesktopLevelChanged(object? sender, float level)
    {
        Dispatcher.Invoke(() =>
        {
            var maxWidth = 220;
            DesktopLevelBar.Width = level * maxWidth;
            DesktopLevelBar.Background = GetLevelBrush(level);
        });
    }
    
    private Brush GetLevelBrush(float level)
    {
        if (level < 0.5f)
            return new SolidColorBrush((Color)ColorConverter.ConvertFromString("#22C55E")); // Green
        if (level < 0.8f)
            return new SolidColorBrush((Color)ColorConverter.ConvertFromString("#F59E0B")); // Yellow
        return new SolidColorBrush((Color)ColorConverter.ConvertFromString("#EF4444")); // Red
    }
    
    private string FormatPhoneNumber(string phone)
    {
        // Simple US format
        if (phone.Length == 10)
            return $"({phone[..3]}) {phone[3..6]}-{phone[6..]}";
        if (phone.Length == 11 && phone.StartsWith("1"))
            return $"+1 ({phone[1..4]}) {phone[4..7]}-{phone[7..]}";
        return phone;
    }
    
    private void CollectFormData()
    {
        _currentRecord.ReceptionistName = ReceptionistNameInput.Text;
        _currentRecord.OwnerName = OwnerNameInput.Text;
        _currentRecord.PostCallNotes = NotesInput.Text;
        _currentRecord.InterestLevel = (int)InterestSlider.Value;
        
        if (OutcomeComboBox.SelectedIndex > 0)
        {
            var outcomeText = (OutcomeComboBox.SelectedItem as System.Windows.Controls.ComboBoxItem)?.Content?.ToString();
            _currentRecord.CallOutcome = outcomeText switch
            {
                "Interested" => CallOutcome.Interested,
                "Not Interested" => CallOutcome.NotInterested,
                "Callback" => CallOutcome.Callback,
                "No Answer" => CallOutcome.NoAnswer,
                "Wrong Number" => CallOutcome.WrongNumber,
                _ => CallOutcome.Other
            };
        }
        
        if (CallbackDatePicker.SelectedDate.HasValue)
        {
            var date = CallbackDatePicker.SelectedDate.Value;
            var time = CallbackTimePicker.SelectedTime ?? TimeSpan.Zero;
            _currentRecord.CallbackTime = date.Add(time);
        }
    }
    
    private void SaveAndClose()
    {
        CollectFormData();
        
        if (_isRecording)
            StopRecording();
        
        _countdownTimer?.Stop();
        
        // TODO: Save to local database
        // TODO: Queue for PocketBase sync
        
        MessageBox.Show(
            $"Recording saved!\n\nPhone: {_currentRecord.PhoneNumber}\nDuration: {_currentRecord.Duration:mm\\:ss}\nFile: {_currentRecord.LocalFilePath}",
            "Call Recorded",
            MessageBoxButton.OK,
            MessageBoxImage.Information);
        
        Hide();
        ResetForm();
    }
    
    private void ResetForm()
    {
        ReceptionistNameInput.Text = "";
        OwnerNameInput.Text = "";
        NotesInput.Text = "";
        InterestSlider.Value = 5;
        OutcomeComboBox.SelectedIndex = 0;
        CallbackDatePicker.SelectedDate = null;
        CallbackTimePicker.SelectedTime = null;
        CountdownBanner.Visibility = Visibility.Collapsed;
        WarningBanner.Visibility = Visibility.Collapsed;
        TimerLabel.Text = "00:00";
    }
    
    #region Window Events
    
    private void Header_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 1)
            DragMove();
    }
    
    private void MinimizeButton_Click(object sender, RoutedEventArgs e)
    {
        WindowState = WindowState.Minimized;
    }
    
    private void CloseButton_Click(object sender, RoutedEventArgs e)
    {
        if (_isRecording)
        {
            var result = MessageBox.Show(
                "Recording in progress. Save and close?",
                "Confirm Close",
                MessageBoxButton.YesNoCancel,
                MessageBoxImage.Question);
            
            if (result == MessageBoxResult.Yes)
                SaveAndClose();
            else if (result == MessageBoxResult.No)
            {
                StopRecording();
                Hide();
            }
        }
        else
        {
            Hide();
        }
    }
    
    private void SaveButton_Click(object sender, RoutedEventArgs e)
    {
        _countdownTimer?.Stop();
        SaveAndClose();
    }
    
    #endregion
    
    protected override void OnClosed(EventArgs e)
    {
        _timerUpdateTimer?.Stop();
        _blinkTimer?.Stop();
        _countdownTimer?.Stop();
        
        if (_isRecording)
            _audioRecorder.StopRecording();
        
        base.OnClosed(e);
    }
}
