namespace Kairo.Application.Configuration;

/// <summary>
/// Phase 5.8: Configuration options for project quota enforcement.
/// </summary>
public class QuotaOptions
{
    public const string SectionName = "Quota";

    /// <summary>
    /// When true, quota check storage or connectivity failures log a warning and allow
    /// the request (fail-open), prioritizing service availability.
    /// When false, failures return HTTP 429 quota exceeded (fail-closed), prioritizing strict limit enforcement.
    /// Default is true.
    /// </summary>
    public bool FailOpen { get; set; } = true;
}
