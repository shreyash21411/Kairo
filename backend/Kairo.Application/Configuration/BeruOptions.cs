namespace Kairo.Application.Configuration;

/// <summary>
/// Configuration options for the BERU Voice Agent.
/// Bound from the "Beru" section in IConfiguration.
/// Defaults to Enabled = false (isolated feature flag).
/// </summary>
public class BeruOptions
{
    public const string SectionName = "Beru";

    /// <summary>
    /// Feature flag controlling whether the BERU voice agent endpoints are active.
    /// Defaults to false. When false, BERU endpoints return HTTP 503 without invoking Meta AI.
    /// </summary>
    public bool Enabled { get; set; } = false;

    /// <summary>Model identifier used by BERU.</summary>
    public string Model { get; set; } = "muse-spark-1.3";

    /// <summary>Maximum tokens generated in a single BERU reply (concise for voice).</summary>
    public int MaxCompletionTokens { get; set; } = 800;

    /// <summary>Temperature for natural conversational voice responses.</summary>
    public double Temperature { get; set; } = 0.3;
}

