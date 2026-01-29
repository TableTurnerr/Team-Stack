using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;
using CallRecorder.Core.Models;

namespace CallRecorder.Infrastructure.PocketBase;

/// <summary>
/// Client for PocketBase API integration
/// </summary>
public class PocketBaseClient
{
    private readonly HttpClient _httpClient;
    private string? _authToken;
    private string? _userId;
    
    public bool IsAuthenticated => !string.IsNullOrEmpty(_authToken);
    public string? UserId => _userId;
    
    public PocketBaseClient(string baseUrl)
    {
        _httpClient = new HttpClient
        {
            BaseAddress = new Uri(baseUrl.TrimEnd('/') + "/")
        };
    }
    
    /// <summary>
    /// Authenticates with email and password
    /// </summary>
    public async Task<AuthResult> LoginAsync(string email, string password)
    {
        try
        {
            var response = await _httpClient.PostAsJsonAsync(
                "api/collections/users/auth-with-password",
                new { identity = email, password });
            
            if (response.IsSuccessStatusCode)
            {
                var result = await response.Content.ReadFromJsonAsync<AuthResponse>();
                if (result != null)
                {
                    _authToken = result.Token;
                    _userId = result.Record?.Id;
                    UpdateAuthHeader();
                    
                    return new AuthResult
                    {
                        Success = true,
                        Token = result.Token,
                        UserId = result.Record?.Id,
                        UserName = result.Record?.Name ?? result.Record?.Email
                    };
                }
            }
            
            var error = await response.Content.ReadAsStringAsync();
            return new AuthResult { Success = false, Error = error };
        }
        catch (Exception ex)
        {
            return new AuthResult { Success = false, Error = ex.Message };
        }
    }
    
    /// <summary>
    /// Sets auth token directly (from stored config)
    /// </summary>
    public void SetAuthToken(string token, string userId)
    {
        _authToken = token;
        _userId = userId;
        UpdateAuthHeader();
    }
    
    private void UpdateAuthHeader()
    {
        _httpClient.DefaultRequestHeaders.Remove("Authorization");
        if (!string.IsNullOrEmpty(_authToken))
        {
            _httpClient.DefaultRequestHeaders.Add("Authorization", _authToken);
        }
    }
    
    /// <summary>
    /// Looks up a phone number to find company
    /// </summary>
    public async Task<PhoneNumberMatch?> MatchPhoneNumberAsync(string phoneNumber)
    {
        if (!IsAuthenticated) return null;
        
        try
        {
            // Clean phone number
            var cleanPhone = new string(phoneNumber.Where(char.IsDigit).ToArray());
            
            var response = await _httpClient.GetAsync(
                $"api/collections/phone_numbers/records?filter=(phone_number~\"{cleanPhone}\")&expand=company");
            
            if (response.IsSuccessStatusCode)
            {
                var result = await response.Content.ReadFromJsonAsync<ListResponse<PhoneNumberRecord>>();
                var record = result?.Items?.FirstOrDefault();
                
                if (record != null)
                {
                    return new PhoneNumberMatch
                    {
                        PhoneNumberRecordId = record.Id,
                        PhoneNumber = record.PhoneNumber,
                        CompanyId = record.Company,
                        CompanyName = record.Expand?.Company?.CompanyName,
                        Label = record.Label
                    };
                }
            }
        }
        catch
        {
            // Ignore errors, caller will handle null result
        }
        
        return null;
    }
    
    /// <summary>
    /// Creates a new company with phone number (when no match found)
    /// </summary>
    public async Task<PhoneNumberMatch?> CreateCompanyWithPhoneAsync(string phoneNumber)
    {
        if (!IsAuthenticated) return null;
        
        try
        {
            // Create company with phone as name
            var companyResponse = await _httpClient.PostAsJsonAsync(
                "api/collections/companies/records",
                new { company_name = phoneNumber, status = "New" });
            
            if (!companyResponse.IsSuccessStatusCode)
                return null;
            
            var company = await companyResponse.Content.ReadFromJsonAsync<CompanyRecord>();
            if (company == null) return null;
            
            // Create phone number record
            var phoneResponse = await _httpClient.PostAsJsonAsync(
                "api/collections/phone_numbers/records",
                new { phone_number = phoneNumber, company = company.Id, label = "Main" });
            
            if (!phoneResponse.IsSuccessStatusCode)
                return null;
            
            var phone = await phoneResponse.Content.ReadFromJsonAsync<PhoneNumberRecord>();
            
            return new PhoneNumberMatch
            {
                PhoneNumberRecordId = phone?.Id,
                PhoneNumber = phoneNumber,
                CompanyId = company.Id,
                CompanyName = phoneNumber
            };
        }
        catch
        {
            return null;
        }
    }
    
    /// <summary>
    /// Uploads a recording
    /// </summary>
    public async Task<string?> UploadRecordingAsync(CallRecord record, string filePath)
    {
        if (!IsAuthenticated) return null;
        
        try
        {
            using var content = new MultipartFormDataContent();
            
            // Add file
            var fileBytes = await File.ReadAllBytesAsync(filePath);
            var fileContent = new ByteArrayContent(fileBytes);
            fileContent.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("audio/mpeg");
            content.Add(fileContent, "file", Path.GetFileName(filePath));
            
            // Add fields
            content.Add(new StringContent(record.PhoneNumber ?? ""), "phone_number");
            content.Add(new StringContent(_userId ?? ""), "uploader");
            content.Add(new StringContent(_userId ?? ""), "caller");
            content.Add(new StringContent(record.CallTime.ToString("yyyy-MM-dd HH:mm:ss")), "recording_date");
            content.Add(new StringContent(((int)record.Duration.TotalSeconds).ToString()), "duration");
            
            if (!string.IsNullOrEmpty(record.PhoneNumberRecordId))
                content.Add(new StringContent(record.PhoneNumberRecordId), "phone_number_record");
            if (!string.IsNullOrEmpty(record.CompanyId))
                content.Add(new StringContent(record.CompanyId), "company");
            if (!string.IsNullOrEmpty(record.ReceptionistName))
                content.Add(new StringContent(record.ReceptionistName), "receptionist_name");
            if (!string.IsNullOrEmpty(record.OwnerName))
                content.Add(new StringContent(record.OwnerName), "owner_name");
            if (!string.IsNullOrEmpty(record.PostCallNotes))
                content.Add(new StringContent(record.PostCallNotes), "post_call_notes");
            if (record.CallOutcome.HasValue)
                content.Add(new StringContent(record.CallOutcome.Value.ToString()), "call_outcome");
            if (record.InterestLevel.HasValue)
                content.Add(new StringContent(record.InterestLevel.Value.ToString()), "interest_level");
            if (record.CallbackTime.HasValue)
                content.Add(new StringContent(record.CallbackTime.Value.ToString("yyyy-MM-dd HH:mm:ss")), "callback_time");
            if (!string.IsNullOrEmpty(record.Note))
                content.Add(new StringContent(record.Note), "note");
            
            var response = await _httpClient.PostAsync("api/collections/recordings/records", content);
            
            if (response.IsSuccessStatusCode)
            {
                var result = await response.Content.ReadFromJsonAsync<RecordingRecord>();
                return result?.Id;
            }
        }
        catch
        {
            // Caller handles null result
        }
        
        return null;
    }
}

#region API Response Models

public class AuthResult
{
    public bool Success { get; set; }
    public string? Token { get; set; }
    public string? UserId { get; set; }
    public string? UserName { get; set; }
    public string? Error { get; set; }
}

public class AuthResponse
{
    [JsonPropertyName("token")]
    public string? Token { get; set; }
    
    [JsonPropertyName("record")]
    public UserRecord? Record { get; set; }
}

public class UserRecord
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }
    
    [JsonPropertyName("email")]
    public string? Email { get; set; }
    
    [JsonPropertyName("name")]
    public string? Name { get; set; }
}

public class ListResponse<T>
{
    [JsonPropertyName("items")]
    public List<T>? Items { get; set; }
    
    [JsonPropertyName("totalItems")]
    public int TotalItems { get; set; }
}

public class PhoneNumberRecord
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }
    
    [JsonPropertyName("phone_number")]
    public string? PhoneNumber { get; set; }
    
    [JsonPropertyName("company")]
    public string? Company { get; set; }
    
    [JsonPropertyName("label")]
    public string? Label { get; set; }
    
    [JsonPropertyName("expand")]
    public PhoneNumberExpand? Expand { get; set; }
}

public class PhoneNumberExpand
{
    [JsonPropertyName("company")]
    public CompanyRecord? Company { get; set; }
}

public class CompanyRecord
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }
    
    [JsonPropertyName("company_name")]
    public string? CompanyName { get; set; }
}

public class RecordingRecord
{
    [JsonPropertyName("id")]
    public string? Id { get; set; }
}

public class PhoneNumberMatch
{
    public string? PhoneNumberRecordId { get; set; }
    public string? PhoneNumber { get; set; }
    public string? CompanyId { get; set; }
    public string? CompanyName { get; set; }
    public string? Label { get; set; }
}

#endregion
