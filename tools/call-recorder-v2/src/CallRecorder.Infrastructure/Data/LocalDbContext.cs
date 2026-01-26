using Microsoft.EntityFrameworkCore;
using CallRecorder.Core.Models;

namespace CallRecorder.Infrastructure.Data;

/// <summary>
/// Local SQLite database context for offline storage
/// </summary>
public class LocalDbContext : DbContext
{
    public DbSet<CallRecordEntity> CallRecords { get; set; }
    public DbSet<ConfigEntity> Config { get; set; }
    
    private readonly string _dbPath;
    
    public LocalDbContext()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var appFolder = Path.Combine(appData, "CallRecorder");
        
        if (!Directory.Exists(appFolder))
            Directory.CreateDirectory(appFolder);
        
        _dbPath = Path.Combine(appFolder, "callrecorder.db");
    }
    
    protected override void OnConfiguring(DbContextOptionsBuilder optionsBuilder)
    {
        optionsBuilder.UseSqlite($"Data Source={_dbPath}");
    }
    
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<CallRecordEntity>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.Id).HasMaxLength(15);
            entity.Property(e => e.PhoneNumber).HasMaxLength(20);
            entity.Property(e => e.SyncStatus).HasConversion<string>();
            entity.Property(e => e.CallOutcome).HasConversion<string>();
        });
        
        modelBuilder.Entity<ConfigEntity>(entity =>
        {
            entity.HasKey(e => e.Key);
            entity.Property(e => e.Key).HasMaxLength(100);
        });
    }
}

/// <summary>
/// Database entity for call records
/// </summary>
public class CallRecordEntity
{
    public string Id { get; set; } = null!;
    
    // Auto-captured
    public string? PhoneNumber { get; set; }
    public string? PhoneNumberRecordId { get; set; }
    public string? CompanyId { get; set; }
    public string? CompanyName { get; set; }
    public string? CallerId { get; set; }
    public DateTime CallTime { get; set; }
    public long DurationSeconds { get; set; }
    
    // User-entered
    public string? ReceptionistName { get; set; }
    public string? OwnerName { get; set; }
    public DateTime? CallbackTime { get; set; }
    public string? PostCallNotes { get; set; }
    public CallOutcome? CallOutcome { get; set; }
    public int? InterestLevel { get; set; }
    public string? Note { get; set; }
    
    // File
    public string? LocalFilePath { get; set; }
    public string? RemoteFileId { get; set; }
    
    // Sync
    public SyncStatus SyncStatus { get; set; }
    public DateTime? LastSyncAttempt { get; set; }
    public string? SyncError { get; set; }
    
    public DateTime Created { get; set; }
    public DateTime Updated { get; set; }
    
    public CallRecord ToModel() => new()
    {
        Id = Id,
        PhoneNumber = PhoneNumber,
        PhoneNumberRecordId = PhoneNumberRecordId,
        CompanyId = CompanyId,
        CompanyName = CompanyName,
        CallerId = CallerId,
        CallTime = CallTime,
        Duration = TimeSpan.FromSeconds(DurationSeconds),
        ReceptionistName = ReceptionistName,
        OwnerName = OwnerName,
        CallbackTime = CallbackTime,
        PostCallNotes = PostCallNotes,
        CallOutcome = CallOutcome,
        InterestLevel = InterestLevel,
        Note = Note,
        LocalFilePath = LocalFilePath,
        RemoteFileId = RemoteFileId,
        SyncStatus = SyncStatus,
        LastSyncAttempt = LastSyncAttempt,
        SyncError = SyncError,
        Created = Created,
        Updated = Updated
    };
    
    public static CallRecordEntity FromModel(CallRecord model) => new()
    {
        Id = model.Id,
        PhoneNumber = model.PhoneNumber,
        PhoneNumberRecordId = model.PhoneNumberRecordId,
        CompanyId = model.CompanyId,
        CompanyName = model.CompanyName,
        CallerId = model.CallerId,
        CallTime = model.CallTime,
        DurationSeconds = (long)model.Duration.TotalSeconds,
        ReceptionistName = model.ReceptionistName,
        OwnerName = model.OwnerName,
        CallbackTime = model.CallbackTime,
        PostCallNotes = model.PostCallNotes,
        CallOutcome = model.CallOutcome,
        InterestLevel = model.InterestLevel,
        Note = model.Note,
        LocalFilePath = model.LocalFilePath,
        RemoteFileId = model.RemoteFileId,
        SyncStatus = model.SyncStatus,
        LastSyncAttempt = model.LastSyncAttempt,
        SyncError = model.SyncError,
        Created = model.Created,
        Updated = model.Updated
    };
}

/// <summary>
/// Key-value config storage
/// </summary>
public class ConfigEntity
{
    public string Key { get; set; } = null!;
    public string? Value { get; set; }
}
