namespace CallRecorder.Core.Models;

/// <summary>
/// Represents a recorded call with all associated metadata
/// </summary>
public class CallRecord
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..15];
    
    // Auto-captured fields
    public string? PhoneNumber { get; set; }
    public string? PhoneNumberRecordId { get; set; }
    public string? CompanyId { get; set; }
    public string? CompanyName { get; set; }
    public string? CallerId { get; set; }
    public DateTime CallTime { get; set; }
    public TimeSpan Duration { get; set; }
    
    // User-entered fields
    public string? ReceptionistName { get; set; }
    public string? OwnerName { get; set; }
    public DateTime? CallbackTime { get; set; }
    public string? PostCallNotes { get; set; }
    public CallOutcome? CallOutcome { get; set; }
    public int? InterestLevel { get; set; }
    public string? Note { get; set; }
    
    // Recording file
    public string? LocalFilePath { get; set; }
    public string? RemoteFileId { get; set; }
    
    // Sync status
    public SyncStatus SyncStatus { get; set; } = SyncStatus.Pending;
    public DateTime? LastSyncAttempt { get; set; }
    public string? SyncError { get; set; }
    
    public DateTime Created { get; set; } = DateTime.UtcNow;
    public DateTime Updated { get; set; } = DateTime.UtcNow;
}

public enum CallOutcome
{
    Interested,
    NotInterested,
    Callback,
    NoAnswer,
    WrongNumber,
    Other
}

public enum SyncStatus
{
    Pending,
    Synced,
    Failed
}
