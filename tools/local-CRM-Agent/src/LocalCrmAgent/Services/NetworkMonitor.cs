using System.Diagnostics;
using System.Net.NetworkInformation;
using LocalCrmAgent.Models;

namespace LocalCrmAgent.Services;

/// <summary>
/// Monitors network quality by pinging reliable hosts.
/// Reports latency, jitter, and stability to help the CRM
/// distinguish real call-end events from network hiccups.
/// </summary>
public class NetworkMonitor : IDisposable
{
    private readonly string[] _pingTargets = ["8.8.8.8", "1.1.1.1"];
    private readonly Queue<double> _latencies = new();
    private const int MaxSamples = 30;
    private const int PingTimeoutMs = 2000;

    // Thresholds for "stable" network
    private const double MaxStableLatencyMs = 200;
    private const double MaxStableJitter = 50;
    private const double MaxStablePacketLoss = 0.1; // 10%

    private int _totalPings;
    private int _failedPings;
    private readonly object _lock = new();

    public NetworkQualityMessage GetNetworkQuality()
    {
        lock (_lock)
        {
            return new NetworkQualityMessage
            {
                LatencyMs = _latencies.Count > 0 ? _latencies.Average() : 0,
                Jitter = CalculateJitter(),
                PacketLoss = _totalPings > 0 ? (double)_failedPings / _totalPings : 0,
                IsStable = IsStable(),
            };
        }
    }

    /// <summary>
    /// Perform a single ping measurement. Called periodically by AgentService.
    /// </summary>
    public void Measure()
    {
        foreach (var target in _pingTargets)
        {
            try
            {
                using var ping = new Ping();
                var reply = ping.Send(target, PingTimeoutMs);

                lock (_lock)
                {
                    _totalPings++;

                    if (reply.Status == IPStatus.Success)
                    {
                        _latencies.Enqueue(reply.RoundtripTime);
                        while (_latencies.Count > MaxSamples)
                            _latencies.Dequeue();
                        return; // Success — no need to try other targets
                    }

                    _failedPings++;
                }
            }
            catch
            {
                lock (_lock)
                {
                    _totalPings++;
                    _failedPings++;
                }
            }
        }
    }

    private double CalculateJitter()
    {
        if (_latencies.Count < 2) return 0;

        var arr = _latencies.ToArray();
        double sumDiffs = 0;
        for (int i = 1; i < arr.Length; i++)
            sumDiffs += Math.Abs(arr[i] - arr[i - 1]);

        return sumDiffs / (arr.Length - 1);
    }

    private bool IsStable()
    {
        if (_latencies.Count == 0) return true; // no data yet, assume stable

        var avgLatency = _latencies.Average();
        var jitter = CalculateJitter();
        var packetLoss = _totalPings > 0 ? (double)_failedPings / _totalPings : 0;

        return avgLatency < MaxStableLatencyMs
            && jitter < MaxStableJitter
            && packetLoss < MaxStablePacketLoss;
    }

    public void Dispose() { }
}
