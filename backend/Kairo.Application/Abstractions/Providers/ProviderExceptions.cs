using System;
using System.Net.Http;

namespace Kairo.Application.Abstractions.Providers;

/// <summary>
/// Phase 4B: Base exception for non-transient provider failures.
/// Never exposes raw API keys, authorization tokens, or unsanitized response payloads.
/// </summary>
public class ProviderException : Exception
{
    public string ProviderName { get; }
    public int? StatusCode { get; }

    public ProviderException(string providerName, string message, int? statusCode = null, Exception? inner = null)
        : base($"[Provider:{providerName}] {message}", inner)
    {
        ProviderName = providerName;
        StatusCode = statusCode;
    }
}

/// <summary>
/// Thrown when provider returns HTTP 401 Unauthorized or 403 Forbidden.
/// Non-retryable permanent failure.
/// </summary>
public class ProviderAuthenticationException : ProviderException
{
    public ProviderAuthenticationException(string providerName, string message)
        : base(providerName, message, 401)
    {
    }
}

/// <summary>
/// Thrown on rate limiting (HTTP 429) or transient network/server errors (500, 502, 503, 504, connection drops).
/// Inherits from HttpRequestException so the frozen Phase 4A MemoryJobService worker automatically catches it
/// and schedules a retry with exponential backoff without modifying frozen worker code.
/// </summary>
public class ProviderTransientException : HttpRequestException
{
    public string ProviderName { get; }
    public int? StatusCodeNumber { get; }

    public ProviderTransientException(string providerName, string message, int? statusCode = null, Exception? inner = null)
        : base($"[Provider:{providerName}] {message}", inner)
    {
        ProviderName = providerName;
        StatusCodeNumber = statusCode;
    }
}

/// <summary>
/// Thrown when provider emits an embedding vector whose length does not match expected model dimensions.
/// Non-retryable permanent failure.
/// </summary>
public class IncompatibleEmbeddingDimensionException : ProviderException
{
    public int ExpectedDimensions { get; }
    public int ActualDimensions { get; }

    public IncompatibleEmbeddingDimensionException(string modelName, int expectedDimensions, int actualDimensions)
        : base("EmbeddingProvider", $"Model '{modelName}' emitted vector of dimension {actualDimensions}, expected {expectedDimensions}.", 400)
    {
        ExpectedDimensions = expectedDimensions;
        ActualDimensions = actualDimensions;
    }
}
