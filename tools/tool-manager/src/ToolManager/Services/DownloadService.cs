using System.Diagnostics;

namespace ToolManager.Services;

public class DownloadService : IDisposable
{
    private readonly HttpClient _http = new();

    public async Task<string> DownloadAsync(
        string url,
        IProgress<(long downloaded, long? total)>? progress = null,
        CancellationToken ct = default)
    {
        Debug.WriteLine($"[Download] Starting: {url}");

        using var response = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        var totalBytes = response.Content.Headers.ContentLength;
        var tempFile = Path.Combine(Path.GetTempPath(), $"ToolManager_{Guid.NewGuid():N}.zip");

        await using var contentStream = await response.Content.ReadAsStreamAsync(ct);
        await using var fileStream = File.Create(tempFile);

        var buffer = new byte[81920];
        long totalRead = 0;
        int bytesRead;

        while ((bytesRead = await contentStream.ReadAsync(buffer, ct)) > 0)
        {
            await fileStream.WriteAsync(buffer.AsMemory(0, bytesRead), ct);
            totalRead += bytesRead;
            progress?.Report((totalRead, totalBytes));
        }

        // Verify download completeness
        if (totalBytes.HasValue && totalRead != totalBytes.Value)
            throw new IOException($"Partial download: received {totalRead} of {totalBytes.Value} bytes");

        Debug.WriteLine($"[Download] Complete: {totalRead} bytes -> {tempFile}");
        return tempFile;
    }

    public void Dispose() => _http.Dispose();
}
