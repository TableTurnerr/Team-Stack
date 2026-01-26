using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using CallRecorder.Core.Services;

namespace CallRecorder.App;

public partial class App : Application
{
    public static IServiceProvider Services { get; private set; } = null!;
    
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        
        // Configure services
        var services = new ServiceCollection();
        ConfigureServices(services);
        Services = services.BuildServiceProvider();
    }
    
    private void ConfigureServices(IServiceCollection services)
    {
        // Core services
        services.AddSingleton<WindowService>();
        services.AddSingleton<ScreenCaptureService>();
        services.AddSingleton<OcrService>();
        services.AddSingleton<CallStateService>();
        services.AddSingleton<AudioRecorderService>();
        
        // ViewModels would go here
    }
}
