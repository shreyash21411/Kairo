using System;

namespace Kairo.Application.Abstractions.Meta;

/// <summary>
/// Exception hierarchy for Meta Model API failures.
/// Independent of ProviderException — Meta is not ILlmProvider.
/// API keys, authorization headers, and raw response bodies are never included
/// in any exception message.
/// </summary>
public static class MetaAIExceptions
{
    /// <summary>Base exception for all Meta AI client errors.</summary>
    public class MetaAIException : Exception
    {
        public int? HttpStatusCode { get; }

        public MetaAIException(string message, int? httpStatusCode = null, Exception? inner = null)
            : base(message, inner)
        {
            HttpStatusCode = httpStatusCode;
        }
    }

    /// <summary>
    /// Thrown when MetaAI:Enabled is false.
    /// No API call was made.
    /// </summary>
    public class MetaAIDisabledException : MetaAIException
    {
        public MetaAIDisabledException()
            : base("The Meta AI integration is disabled. Set MetaAI:Enabled = true to enable it.")
        {
        }
    }

    /// <summary>
    /// Thrown when the estimated input size exceeds MetaAI:MaxInputTokenEstimate.
    /// Estimation is approximate (characters / 4). No API call was made.
    /// </summary>
    public class MetaAIInputTooLargeException : MetaAIException
    {
        public int EstimatedTokens { get; }
        public int MaxTokens { get; }

        public MetaAIInputTooLargeException(int estimatedTokens, int maxTokens)
            : base($"Estimated input ({estimatedTokens} tokens) exceeds configured limit ({maxTokens} tokens). Trim the transcript and retry.")
        {
            EstimatedTokens = estimatedTokens;
            MaxTokens = maxTokens;
        }
    }

    /// <summary>
    /// Thrown on HTTP 401 Unauthorized or 403 Forbidden.
    /// Non-retryable. Verify MetaAI:ApiKey in User Secrets.
    /// </summary>
    public class MetaAIAuthException : MetaAIException
    {
        public MetaAIAuthException(int statusCode)
            : base($"Meta AI authentication failed (HTTP {statusCode}). Verify the API key in User Secrets.", statusCode)
        {
        }
    }

    /// <summary>
    /// Thrown on HTTP 429 Too Many Requests.
    /// No automatic retry is performed.
    /// </summary>
    public class MetaAIRateLimitException : MetaAIException
    {
        public MetaAIRateLimitException()
            : base("Meta AI rate limit reached (HTTP 429). Wait before retrying.", 429)
        {
        }
    }

    /// <summary>
    /// Thrown when the Meta API returns malformed, non-JSON, or schema-invalid content.
    /// </summary>
    public class MetaAIMalformedResponseException : MetaAIException
    {
        public MetaAIMalformedResponseException(string detail)
            : base($"Meta AI returned a malformed or incomplete response: {detail}")
        {
        }

        public MetaAIMalformedResponseException(string detail, Exception? inner)
            : base($"Meta AI returned a malformed or incomplete response: {detail}", null, inner)
        {
        }
    }
}
