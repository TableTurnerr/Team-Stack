using ToolManager.Models;

namespace ToolManager.Services.Handlers;

public interface IToolTypeHandler
{
    string TypeName { get; }
    Task Install(string stagingPath, string installPath, ToolManifest manifest);
    Task Uninstall(InstalledTool tool);
}
